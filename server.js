import fs from 'fs'
import path from 'path'
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import admin from 'firebase-admin'
import Razorpay from 'razorpay'
import crypto from 'crypto'

dotenv.config()

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
})

const app = express()
const PORT = process.env.PORT || 5000

/*
 * CORS configuration
 *
 * CORS_ORIGINS  — comma-separated exact origins allowed in production.
 *   e.g. CORS_ORIGINS=https://fleetmobilities.vercel.app,https://fleet-rental.vercel.app
 *
 * CORS_PATTERN  — optional JS regex string to allow dynamic origins such as
 *   Vercel preview URLs.  No delimiters, no flags.
 *   e.g. CORS_PATTERN=https://fleet-rental-[a-z0-9-]+\.vercel\.app
 */
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const corsPattern = process.env.CORS_PATTERN
  ? new RegExp(`^${process.env.CORS_PATTERN}$`)
  : null

const isDevMode = process.env.NODE_ENV !== 'production'

app.use(cors({
  origin(origin, callback) {
    // Allow server-to-server, curl, Postman, etc.
    if (!origin) return callback(null, true)
    if (allowedOrigins.includes(origin)) return callback(null, true)
    // Allow dynamic preview URLs matched by CORS_PATTERN
    if (corsPattern && corsPattern.test(origin)) return callback(null, true)
    // In development, allow any localhost / 127.0.0.1 origin automatically
    if (isDevMode && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true)
    }
    console.warn(`[CORS] Blocked origin: ${origin}`)
    return callback(new Error('Origin not allowed by CORS'))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  preflightContinue: false,
  optionsSuccessStatus: 204,
}))

app.use(express.json({ limit: '1mb' }))

let firebaseInitError = null
let firebaseMode = 'not_configured'

if (!admin.apps.length) {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
      const serviceAccount = JSON.parse(
        Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'),
      )
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
      firebaseMode = 'service_account_base64'
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const credentialsPath = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS)
      if (!fs.existsSync(credentialsPath)) {
        throw new Error(`GOOGLE_APPLICATION_CREDENTIALS points to a missing file: ${credentialsPath}`)
      }
      admin.initializeApp({ credential: admin.credential.applicationDefault() })
      firebaseMode = 'application_default'
    } else if (process.env.FIREBASE_PROJECT_ID) {
      admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID })
      firebaseMode = 'project_id_only'
    } else {
      throw new Error('Firebase Admin credentials are not configured')
    }
  } catch (error) {
    firebaseInitError = error
    console.warn(`[Firebase Admin] ${error.message}`)
    console.warn('[Firebase Admin] Firebase-backed API routes will return 503 until credentials are configured.')
  }
}

const db = admin.apps.length ? admin.firestore() : null

function requireFirebase(req, res, next) {
  if (db && admin.apps.length) return next()
  return res.status(503).json({
    error: firebaseInitError?.message || 'Firebase Admin credentials are not configured',
  })
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  return admin.auth().verifyIdToken(token)
    .then((decoded) => {
      req.user = decoded
      return next()
    })
    .catch(() => res.status(401).json({ error: 'Invalid authentication token' }))
}

function getBookingWindow(details) {
  const pickupDate = details.pickupDate
  const dropoffDate = details.dropoffDate
  const pickupTime = details.pickupTime || '10:00'
  const dropoffTime = details.dropoffTime || '10:00'
  const start = new Date(`${pickupDate}T${pickupTime}:00+05:30`)
  const end = new Date(`${dropoffDate}T${dropoffTime}:00+05:30`)

  if (!pickupDate || !dropoffDate || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Valid pickup and dropoff dates are required')
  }

  if (end <= start) {
    throw new Error('Dropoff must be after pickup')
  }

  return { start, end, pickupTime, dropoffTime }
}

async function priceBooking(details) {
  const vehicleId = details.vehicleId
  if (!vehicleId) throw new Error('Vehicle is required')

  const vehicleRef = db.collection('vehicles').doc(vehicleId)
  const vehicleSnap = await vehicleRef.get()
  if (!vehicleSnap.exists) throw new Error('Vehicle not found')

  const vehicle = { id: vehicleSnap.id, ...vehicleSnap.data() }
  if (vehicle.status !== 'active' || vehicle.available === false) {
    throw new Error('Vehicle is not available')
  }

  const { start, end, pickupTime, dropoffTime } = getBookingWindow(details)
  const rentalType = ['hourly', 'daily', 'monthly'].includes(details.rentalType)
    ? details.rentalType
    : 'daily'
  const hours = Math.max(2, Math.ceil((end - start) / (1000 * 60 * 60)))
  const days = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)))
  const pricePerHour = Number(vehicle.pricePerHour || Math.round(Number(vehicle.dailyPrice || 0) / 8))
  const pricePerDay = Number(vehicle.dailyPrice || 0)
  const pricePerMonth = Number(vehicle.pricePerMonth || pricePerDay * 22)

  let rentalCharge = pricePerDay * days
  if (rentalType === 'hourly') rentalCharge = pricePerHour * hours
  if (rentalType === 'monthly') rentalCharge = pricePerMonth

  const insurance = details.addons?.insurance ? 1500 : 0
  const subtotal = rentalCharge + insurance
  let couponSavings = 0
  let couponCode = null

  if (details.couponCode) {
    const code = String(details.couponCode).trim().toUpperCase()
    const couponSnap = await db.collection('coupons').doc(code).get()
    if (couponSnap.exists) {
      const coupon = couponSnap.data()
      if (coupon.active && subtotal >= Number(coupon.minAmount || 0)) {
        couponCode = code
        couponSavings = coupon.type === 'percent'
          ? Math.round(subtotal * Number(coupon.discount || 0) / 100)
          : Number(coupon.discount || 0)
      }
    }
  }

  const afterCoupon = Math.max(0, subtotal - couponSavings)
  const gst = Math.round(afterCoupon * 0.18)
  const total = afterCoupon + gst

  return {
    vehicle,
    pricing: {
      dailyRate: pricePerDay,
      hourlyRate: pricePerHour,
      monthlyRate: pricePerMonth,
      rentalCharge,
      insurance,
      couponCode,
      couponSavings,
      gst,
      total,
      subtotal,
      securityDeposit: Number(vehicle.securityDeposit || 5000),
      days,
      hours,
    },
    normalized: {
      pickupTime,
      dropoffTime,
      rentalType,
      pickupDate: details.pickupDate,
      dropoffDate: details.dropoffDate,
    },
  }
}

async function getUserDoc(uid) {
  const snap = await db.collection('users').doc(uid).get()
  return snap.exists ? { id: snap.id, ...snap.data() } : null
}

// Send an FCM push to all of a user's registered devices. Prunes dead tokens.
async function sendPushToUser(uid, { title, body, actionUrl = '' }) {
  try {
    const userDoc = await getUserDoc(uid)
    const tokens = Array.isArray(userDoc?.fcmTokens) ? userDoc.fcmTokens.filter(Boolean) : []
    if (tokens.length === 0) return

    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: { actionUrl: String(actionUrl || '') },
      webpush: { fcmOptions: { link: actionUrl || '/' } },
    })

    // Remove tokens that are no longer valid so the list doesn't grow stale.
    const stale = []
    response.responses.forEach((r, i) => {
      const code = r.error?.code
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
        stale.push(tokens[i])
      }
    })
    if (stale.length > 0) {
      await db.collection('users').doc(uid).update({
        fcmTokens: admin.firestore.FieldValue.arrayRemove(...stale),
      })
    }
  } catch (error) {
    console.error('sendPushToUser failed:', error.message)
  }
}

async function isAdminUser(uid) {
  const userDoc = await getUserDoc(uid)
  return userDoc?.role === 'admin'
}

async function requireBookingAccess(bookingId, uid, { owner = false, renter = false, admin: allowAdmin = true } = {}) {
  const bookingRef = db.collection('bookings').doc(bookingId)
  const bookingSnap = await bookingRef.get()
  if (!bookingSnap.exists) {
    const byPublicId = await db.collection('bookings').where('bookingId', '==', bookingId).limit(1).get()
    if (byPublicId.empty) throw new Error('Booking not found')
    const doc = byPublicId.docs[0]
    return requireBookingAccess(doc.id, uid, { owner, renter, admin: allowAdmin })
  }

  const booking = { id: bookingSnap.id, ...bookingSnap.data() }
  const adminAccess = allowAdmin && await isAdminUser(uid)
  const ownerAccess = owner && booking.ownerId === uid
  const renterAccess = renter && booking.renterId === uid
  if (!adminAccess && !ownerAccess && !renterAccess) {
    const error = new Error('You are not allowed to update this booking')
    error.status = 403
    throw error
  }
  return { bookingRef, booking }
}

function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString()
}

function bookingError(res, error, fallback) {
  return res.status(error.status || 400).json({ error: error.message || fallback })
}

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: db ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    firebase: db ? firebaseMode : 'failed',
    error: firebaseInitError?.message || null,
  })
})

app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next()
  return requireFirebase(req, res, next)
})

app.post('/api/bookings/create', requireAuth, async (req, res) => {
  try {
    const bookingDetails = req.body.bookingDetails || req.body
    const priced = await priceBooking(bookingDetails || {})

    const bid = `FLT-${Date.now().toString().slice(-6)}`
    const bookingRef = db.collection('bookings').doc()

    await db.runTransaction(async (transaction) => {
      const vehicleRef = db.collection('vehicles').doc(priced.vehicle.id)
      const vehicleSnap = await transaction.get(vehicleRef)
      if (!vehicleSnap.exists || vehicleSnap.data().available === false || vehicleSnap.data().status !== 'active') {
        throw new Error('Vehicle is no longer available')
      }

      transaction.set(bookingRef, {
        renterId: req.user.uid,
        renterName: bookingDetails?.renterName || req.user.name || '',
        renterEmail: bookingDetails?.renterEmail || req.user.email || '',
        vehicleId: priced.vehicle.id,
        vehicleName: priced.vehicle.name,
        vehicleImage: priced.vehicle.imageUrl || priced.vehicle.images?.[0] || '',
        ownerId: priced.vehicle.ownerId || '',
        pickupDate: priced.normalized.pickupDate,
        dropoffDate: priced.normalized.dropoffDate,
        pickupTime: priced.normalized.pickupTime,
        dropoffTime: priced.normalized.dropoffTime,
        pickupLocation: bookingDetails?.pickupLocation || priced.vehicle.location || '',
        rentalType: priced.normalized.rentalType,
        totalDays: priced.pricing.days,
        totalHours: priced.pricing.hours,
        pricing: priced.pricing,
        addons: bookingDetails?.addons || {},
        city: priced.vehicle.city || '',
        paymentMethod: bookingDetails?.paymentMethod || 'pay_on_pickup',
        bookingId: bid,
        paymentStatus: 'pay_on_pickup',
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      transaction.update(vehicleRef, { available: false })
    })

    res.status(200).json({
      success: true,
      message: 'Booking confirmed',
      bookingId: bid,
      id: bookingRef.id,
      pricing: priced.pricing,
    })
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to create booking' })
  }
})

app.post('/api/bookings/:id/approve', requireAuth, async (req, res) => {
  try {
    const { bookingRef, booking } = await requireBookingAccess(req.params.id, req.user.uid, { owner: true })
    if (booking.status !== 'pending') throw new Error('Only pending bookings can be approved')
    const startOTP = generateOTP()
    const dropoffPIN = generateOTP()

    await db.runTransaction(async (transaction) => {
      const vehicleRef = db.collection('vehicles').doc(booking.vehicleId)
      transaction.update(bookingRef, {
        status: 'approved',
        startOTP,
        dropoffPIN,
        otpExpiry: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      transaction.update(vehicleRef, { available: false })
    })

    res.status(200).json({ success: true, startOTP, dropoffPIN })
  } catch (error) {
    bookingError(res, error, 'Unable to approve booking')
  }
})

// Vendor fetches the renter's KYC for a booking they own — used on the handover
// screen to verify identity before handing over the vehicle. Authorization is
// enforced by requireBookingAccess({ owner: true }): only the vehicle owner
// (or an admin) can read it, so the renter's documents are never exposed broadly.
app.get('/api/bookings/:id/renter-kyc', requireAuth, async (req, res) => {
  try {
    const { booking } = await requireBookingAccess(req.params.id, req.user.uid, { owner: true })
    const snap = await db.collection('users').doc(booking.renterId).get()
    const u = snap.exists ? snap.data() : {}
    res.status(200).json({
      renterId: booking.renterId,
      name: u.name || booking.renterName || '',
      phone: u.phone || '',
      email: u.email || booking.renterEmail || '',
      kycStatus: u.kycStatus || 'not_submitted',
      isVerified: !!u.isVerified,
      verifiedBadge: !!u.verifiedBadge,
      aadhaarUrl: u.aadhaarUrl || '',
      dlUrl: u.dlUrl || '',
      selfieUrl: u.selfieUrl || '',
    })
  } catch (error) {
    bookingError(res, error, 'Unable to fetch renter KYC')
  }
})

app.post('/api/bookings/:id/reject', requireAuth, async (req, res) => {
  try {
    const { bookingRef, booking } = await requireBookingAccess(req.params.id, req.user.uid, { owner: true })
    if (!['pending', 'approved'].includes(booking.status)) throw new Error('This booking cannot be rejected')

    await db.runTransaction(async (transaction) => {
      const vehicleRef = db.collection('vehicles').doc(booking.vehicleId)
      transaction.update(bookingRef, {
        status: 'cancelled',
        paymentStatus: 'refund_pending',
        cancelledBy: req.user.uid,
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      transaction.update(vehicleRef, { available: true })
    })

    res.status(200).json({ success: true })
  } catch (error) {
    bookingError(res, error, 'Unable to reject booking')
  }
})

app.post('/api/bookings/:id/cancel', requireAuth, async (req, res) => {
  try {
    const { reason, cancellationFee = 0, refundAmount = 0 } = req.body
    if (!reason) throw new Error('Cancellation reason is required')
    const { bookingRef, booking } = await requireBookingAccess(req.params.id, req.user.uid, { renter: true, owner: true })
    if (['completed', 'cancelled'].includes(booking.status)) throw new Error('This booking cannot be cancelled')

    await db.runTransaction(async (transaction) => {
      const vehicleRef = db.collection('vehicles').doc(booking.vehicleId)
      transaction.update(bookingRef, {
        status: 'cancelled',
        paymentStatus: Number(refundAmount) > 0 ? 'refund_pending' : booking.paymentStatus,
        cancelledBy: req.user.uid,
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        cancellationReason: reason,
        cancellationFee: Math.max(0, Number(cancellationFee) || 0),
        refundAmount: Math.max(0, Number(refundAmount) || 0),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      transaction.update(vehicleRef, { available: true })
    })

    res.status(200).json({ success: true })
  } catch (error) {
    bookingError(res, error, 'Unable to cancel booking')
  }
})

app.post('/api/bookings/:id/start', requireAuth, async (req, res) => {
  try {
    const { otp } = req.body
    if (!/^\d{4}$/.test(String(otp || ''))) throw new Error('A valid 4-digit OTP is required')
    const { bookingRef, booking } = await requireBookingAccess(req.params.id, req.user.uid, { renter: true })
    if (booking.status !== 'approved') throw new Error('Only approved bookings can be started')
    if (!booking.startOTP) throw new Error('No OTP is set for this booking')

    const expiry = booking.otpExpiry?.toDate ? booking.otpExpiry.toDate() : null
    if (expiry && expiry < new Date()) throw new Error('OTP expired. Ask the owner to regenerate it.')
    if (booking.startOTP !== String(otp)) throw new Error('Incorrect code. Please check with the owner.')

    await bookingRef.update({
      status: 'active',
      rideStartedAt: admin.firestore.FieldValue.serverTimestamp(),
      startOTP: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    res.status(200).json({ success: true })
  } catch (error) {
    bookingError(res, error, 'Unable to start ride')
  }
})

app.post('/api/bookings/:id/complete', requireAuth, async (req, res) => {
  try {
    const { pin } = req.body
    if (!/^\d{4}$/.test(String(pin || ''))) throw new Error('A valid 4-digit PIN is required')
    const { bookingRef, booking } = await requireBookingAccess(req.params.id, req.user.uid, { renter: true })
    if (booking.status !== 'active') throw new Error('Only active rides can be completed')
    if (!booking.dropoffPIN) throw new Error('No drop-off PIN is set for this booking')
    if (booking.dropoffPIN !== String(pin)) throw new Error('Incorrect PIN. Please check with the owner.')

    await db.runTransaction(async (transaction) => {
      const vehicleRef = db.collection('vehicles').doc(booking.vehicleId)
      const userRef = db.collection('users').doc(req.user.uid)
      const updates = {
        status: 'completed',
        rideEndedAt: admin.firestore.FieldValue.serverTimestamp(),
        dropoffPIN: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }
      transaction.update(bookingRef, updates)
      transaction.update(vehicleRef, { available: true })

      if (booking.rentalType === 'hourly' && booking.rideStartedAt) {
        const startTime = booking.rideStartedAt?.toDate ? booking.rideStartedAt.toDate() : new Date(booking.rideStartedAt)
        const hoursUsed = Math.max(1, Math.ceil((Date.now() - startTime.getTime()) / (1000 * 60 * 60)))
        transaction.update(userRef, {
          tokens: admin.firestore.FieldValue.increment(-hoursUsed),
          tokensUsed: admin.firestore.FieldValue.increment(hoursUsed),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      }
    })

    res.status(200).json({ success: true })
  } catch (error) {
    bookingError(res, error, 'Unable to complete ride')
  }
})

app.post('/api/bookings/:id/review', requireAuth, async (req, res) => {
  try {
    const { rating, subRatings = {}, tags = [], comment = '' } = req.body
    const r = Number(rating)
    if (!Number.isInteger(r) || r < 1 || r > 5) throw new Error('A rating between 1 and 5 is required')

    const { bookingRef, booking } = await requireBookingAccess(req.params.id, req.user.uid, { renter: true })
    if (booking.status !== 'completed') throw new Error('Only completed rides can be reviewed')
    if (booking.reviewed) throw new Error('You have already reviewed this ride')

    const reviewRef = db.collection('reviews').doc()

    await db.runTransaction(async (transaction) => {
      const vehicleRef = booking.vehicleId ? db.collection('vehicles').doc(booking.vehicleId) : null
      const vehicleSnap = vehicleRef ? await transaction.get(vehicleRef) : null

      transaction.set(reviewRef, {
        vehicleId: booking.vehicleId || '',
        bookingId: bookingRef.id,
        renterId: req.user.uid,
        renterName: booking.renterName || req.user.name || 'Anonymous',
        ownerId: booking.ownerId || '',
        rating: r,
        renterRating: r,
        subRatings: {
          cleanliness: Number(subRatings.cleanliness) || 0,
          condition: Number(subRatings.condition) || 0,
          responsiveness: Number(subRatings.responsiveness) || 0,
        },
        tags: Array.isArray(tags) ? tags.slice(0, 10) : [],
        comment: String(comment).slice(0, 1000),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })

      // Recompute the vehicle's running average so displayed stars actually change
      if (vehicleRef && vehicleSnap?.exists) {
        const data = vehicleSnap.data()
        const newCount = (data.reviewCount || 0) + 1
        const newSum = (data.ratingSum || 0) + r
        transaction.update(vehicleRef, {
          reviewCount: newCount,
          ratingSum: newSum,
          rating: Math.round((newSum / newCount) * 10) / 10,
        })
      }

      transaction.update(bookingRef, {
        renterRating: r,
        reviewed: true,
        reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    })

    res.status(200).json({ success: true })
  } catch (error) {
    bookingError(res, error, 'Unable to submit review')
  }
})

// Create an in-app notification AND deliver a push to the target user.
app.post('/api/notifications/send', requireAuth, async (req, res) => {
  try {
    const { userId, type, title, body, actionUrl = '' } = req.body
    if (!userId || !title) {
      return res.status(400).json({ error: 'userId and title are required' })
    }

    await db.collection('notifications').add({
      userId,
      type: type || 'general',
      title,
      body: body || '',
      actionUrl,
      read: false,
      createdBy: req.user.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    // Fire-and-forget push; never let a push failure fail the request.
    sendPushToUser(userId, { title, body, actionUrl })

    res.status(200).json({ success: true })
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to send notification' })
  }
})

app.post('/api/bookings/:id/regenerate-code', requireAuth, async (req, res) => {
  try {
    const { type } = req.body
    if (!['start', 'dropoff'].includes(type)) throw new Error('Code type must be start or dropoff')
    const { bookingRef, booking } = await requireBookingAccess(req.params.id, req.user.uid, { owner: true })
    const newCode = generateOTP()
    const update = type === 'dropoff'
      ? { dropoffPIN: newCode }
      : {
        startOTP: newCode,
        otpExpiry: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
      }

    if (type === 'start' && booking.status !== 'approved') throw new Error('Start OTP can only be regenerated for approved bookings')
    if (type === 'dropoff' && booking.status !== 'active') throw new Error('Drop-off PIN can only be regenerated for active bookings')

    await bookingRef.update({
      ...update,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    res.status(200).json({ success: true, code: newCode })
  } catch (error) {
    bookingError(res, error, 'Unable to regenerate code')
  }
})

// ── Payment Settings ────────────────────────────────────────────────────────
app.get('/api/admin/payment-settings', requireAuth, async (req, res) => {
  try {
    const snap = await db.collection('settings').doc('platform').get()
    const settings = snap.exists ? snap.data() : {}
    res.json({
      tokenAmountType: settings.tokenAmountType || 'fixed',
      tokenFixedAmount: settings.tokenFixedAmount || 500,
      tokenPercentage: settings.tokenPercentage || 20,
      platformCommissionPercent: settings.platformCommissionPercent || 15,
      gstRate: settings.gstRate || 0.18,
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.put('/api/admin/payment-settings', requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid
    if (!(await isAdminUser(uid))) return res.status(403).json({ error: 'Admin access required' })
    const { tokenAmountType, tokenFixedAmount, tokenPercentage, platformCommissionPercent, gstRate, supportEmail } = req.body
    await db.collection('settings').doc('platform').set({
      tokenAmountType: tokenAmountType || 'fixed',
      tokenFixedAmount: Number(tokenFixedAmount) || 500,
      tokenPercentage: Number(tokenPercentage) || 20,
      platformCommissionPercent: Number(platformCommissionPercent) || 15,
      gstRate: Number(gstRate) || 0.18,
      supportEmail: supportEmail || 'help@fleet.in',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true })
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ── Razorpay Payment Endpoints ──────────────────────────────────────────────
app.post('/api/payments/create-order', requireAuth, async (req, res) => {
  try {
    const { bookingId, paymentType } = req.body
    if (!bookingId || !['token', 'full', 'remaining'].includes(paymentType)) {
      return res.status(400).json({ error: 'bookingId and valid paymentType (token|full|remaining) required' })
    }

    // Fetch booking
    let bookingRef = db.collection('bookings').doc(bookingId)
    let bookingSnap = await bookingRef.get()
    if (!bookingSnap.exists) {
      const byPublicId = await db.collection('bookings').where('bookingId', '==', bookingId).limit(1).get()
      if (byPublicId.empty) return res.status(404).json({ error: 'Booking not found' })
      bookingRef = byPublicId.docs[0].ref
      bookingSnap = byPublicId.docs[0]
    }
    const booking = { id: bookingSnap.id, ...bookingSnap.data() }

    // Fetch payment settings
    const settingsSnap = await db.collection('settings').doc('platform').get()
    const settings = settingsSnap.exists ? settingsSnap.data() : {}

    const totalAmount = booking.pricing?.total || 0
    const amountPaid = booking.amountPaid || 0
    let orderAmount = 0

    if (paymentType === 'token') {
      if (settings.tokenAmountType === 'percentage') {
        orderAmount = Math.round(totalAmount * (settings.tokenPercentage || 20) / 100)
      } else {
        orderAmount = settings.tokenFixedAmount || 500
      }
      // Token can't exceed total
      orderAmount = Math.min(orderAmount, totalAmount - amountPaid)
    } else if (paymentType === 'full') {
      orderAmount = totalAmount - amountPaid
    } else if (paymentType === 'remaining') {
      orderAmount = totalAmount - amountPaid
    }

    if (orderAmount <= 0) {
      return res.status(400).json({ error: 'No amount due or already fully paid' })
    }

    // Create Razorpay order (amount in paise)
    const order = await razorpay.orders.create({
      amount: orderAmount * 100,
      currency: 'INR',
      receipt: `${booking.bookingId || booking.id}_${paymentType}`,
      notes: {
        bookingId: booking.id,
        bookingPublicId: booking.bookingId || '',
        paymentType,
        renterId: req.user.uid,
      },
    })

    // Store order reference on booking
    await bookingRef.update({
      [`razorpayOrders.${paymentType}`]: {
        orderId: order.id,
        amount: orderAmount,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    res.json({
      success: true,
      orderId: order.id,
      amount: orderAmount,
      amountInPaise: orderAmount * 100,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID,
      bookingId: booking.id,
      bookingPublicId: booking.bookingId,
    })
  } catch (error) {
    console.error('Create order error:', error)
    res.status(500).json({ error: error.message || 'Failed to create payment order' })
  }
})

app.post('/api/payments/verify', requireAuth, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, bookingId, paymentType } = req.body

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment verification fields' })
    }

    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex')

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed — invalid signature' })
    }

    // Fetch booking
    let bookingRef = db.collection('bookings').doc(bookingId)
    let bookingSnap = await bookingRef.get()
    if (!bookingSnap.exists) {
      const byPublicId = await db.collection('bookings').where('bookingId', '==', bookingId).limit(1).get()
      if (byPublicId.empty) return res.status(404).json({ error: 'Booking not found' })
      bookingRef = byPublicId.docs[0].ref
      bookingSnap = byPublicId.docs[0]
    }
    const booking = { id: bookingSnap.id, ...bookingSnap.data() }

    // Fetch payment details from Razorpay
    const payment = await razorpay.payments.fetch(razorpay_payment_id)
    const paidAmount = payment.amount / 100  // Convert paise to rupees

    const previouslyPaid = booking.amountPaid || 0
    const newTotalPaid = previouslyPaid + paidAmount
    const totalDue = booking.pricing?.total || 0
    const isFullyPaid = newTotalPaid >= totalDue

    // Update booking payment info
    const updateData = {
      amountPaid: newTotalPaid,
      remainingAmount: Math.max(0, totalDue - newTotalPaid),
      paymentStatus: isFullyPaid ? 'paid' : 'token_paid',
      [`payments.${razorpay_payment_id}`]: {
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        amount: paidAmount,
        type: paymentType || (isFullyPaid ? 'full' : 'token'),
        status: 'captured',
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }

    if (paymentType === 'token' && !booking.tokenPaymentId) {
      updateData.tokenAmount = paidAmount
      updateData.tokenPaymentId = razorpay_payment_id
    }

    await bookingRef.update(updateData)

    // If fully paid, trigger payment split
    let splitResult = null
    if (isFullyPaid) {
      splitResult = await splitPayment(booking.id || bookingSnap.id, razorpay_payment_id, totalDue, booking.ownerId)
    }

    // Notify vendor
    const notifTitle = isFullyPaid ? 'Full Payment Received 💰' : 'Token Payment Received 💰'
    const notifBody = isFullyPaid
      ? `₹${totalDue.toLocaleString('en-IN')} received for ${booking.vehicleName}. Payout will be settled shortly.`
      : `Token of ₹${paidAmount.toLocaleString('en-IN')} received for ${booking.vehicleName}. ₹${(totalDue - newTotalPaid).toLocaleString('en-IN')} remaining.`

    if (booking.ownerId) {
      await db.collection('notifications').add({
        userId: booking.ownerId,
        type: 'payment_received',
        title: notifTitle,
        body: notifBody,
        actionUrl: '/vendor/dashboard',
        read: false,
        createdBy: 'system',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      sendPushToUser(booking.ownerId, { title: notifTitle, body: notifBody, actionUrl: '/vendor/dashboard' })
    }

    res.json({
      success: true,
      paymentStatus: isFullyPaid ? 'paid' : 'token_paid',
      amountPaid: newTotalPaid,
      remainingAmount: Math.max(0, totalDue - newTotalPaid),
      splitResult,
    })
  } catch (error) {
    console.error('Payment verify error:', error)
    res.status(500).json({ error: error.message || 'Payment verification failed' })
  }
})

// Internal: Split payment between platform and vendor
async function splitPayment(bookingId, paymentId, totalAmount, ownerId) {
  try {
    // Fetch platform commission setting
    const settingsSnap = await db.collection('settings').doc('platform').get()
    const settings = settingsSnap.exists ? settingsSnap.data() : {}
    const commissionPercent = settings.platformCommissionPercent || 15

    const platformCut = Math.round(totalAmount * commissionPercent / 100)
    const vendorCut = totalAmount - platformCut

    // Get vendor's linked account
    const vendorSnap = await db.collection('users').doc(ownerId).get()
    const vendor = vendorSnap.exists ? vendorSnap.data() : {}
    const linkedAccountId = vendor.razorpayAccountId

    let transferId = null
    let transferStatus = 'pending'

    if (linkedAccountId) {
      try {
        const transfer = await razorpay.payments.transfer(paymentId, {
          transfers: [{
            account: linkedAccountId,
            amount: vendorCut * 100,  // paise
            currency: 'INR',
            on_hold: false,
            notes: {
              bookingId,
              type: 'vendor_payout',
            },
          }],
        })
        transferId = transfer.items?.[0]?.id || null
        transferStatus = 'processed'
      } catch (transferErr) {
        console.error('Razorpay transfer failed:', transferErr.message)
        transferStatus = 'failed'
      }
    } else {
      transferStatus = 'no_linked_account'
    }

    // Record split details on booking
    const bookingRef = db.collection('bookings').doc(bookingId)
    await bookingRef.update({
      splitDetails: {
        platformCut,
        vendorCut,
        platformCommissionPercent: commissionPercent,
        transferId,
        transferStatus,
        paymentId,
        settledAt: transferStatus === 'processed' ? admin.firestore.FieldValue.serverTimestamp() : null,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    return { platformCut, vendorCut, transferId, transferStatus }
  } catch (error) {
    console.error('Split payment error:', error)
    return { error: error.message }
  }
}

app.get('/api/payments/booking/:id/status', requireAuth, async (req, res) => {
  try {
    let bookingSnap = await db.collection('bookings').doc(req.params.id).get()
    if (!bookingSnap.exists) {
      const byPublicId = await db.collection('bookings').where('bookingId', '==', req.params.id).limit(1).get()
      if (byPublicId.empty) return res.status(404).json({ error: 'Booking not found' })
      bookingSnap = byPublicId.docs[0]
    }
    const b = bookingSnap.data()
    res.json({
      paymentStatus: b.paymentStatus || 'pending',
      amountPaid: b.amountPaid || 0,
      remainingAmount: b.remainingAmount || (b.pricing?.total || 0) - (b.amountPaid || 0),
      totalAmount: b.pricing?.total || 0,
      tokenAmount: b.tokenAmount || 0,
      splitDetails: b.splitDetails || null,
      payments: b.payments || {},
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.use((err, req, res, next) => {
  if (err.message === 'Origin not allowed by CORS') {
    console.warn(`[CORS] Rejected ${req.method} ${req.path} from origin: ${req.headers.origin || 'unknown'}`)
    return res.status(403).json({ error: err.message })
  }
  return next(err)
})

// Only start a long-running server when run directly (local dev / a Node host
// like Render/Railway). On Vercel the app is imported as a serverless handler
// (see api/index.js) and must NOT call listen().
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Fleet Backend Server running on port ${PORT}`)
  })
}

export default app
