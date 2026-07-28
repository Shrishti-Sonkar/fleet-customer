import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import PageLayout from '../components/layout/PageLayout'
import Footer from '../components/layout/Footer'
import BookingSteps from '../components/sections/BookingSteps'
import { useBooking } from '../hooks/useBooking'
import { ROUTES } from '@/lib/constants'
import toast from 'react-hot-toast'
import { sendNotification } from '../lib/notificationHelper'
import { generateInvoice } from '../lib/invoiceGenerator'

// ── Date/Time helpers ─────────────────────────────────────────────────────────
function getNext60Days() {
  const days = []
  for (let i = 0; i < 60; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    days.push({
      label: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
      value: d.toISOString().slice(0, 10), // YYYY-MM-DD
    })
  }
  return days
}

function getTimeSlots() {
  const slots = []
  for (let h = 6; h <= 23; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h
      const ampm = h < 12 ? 'AM' : 'PM'
      const label = `${hour12}:${String(m).padStart(2, '0')} ${ampm}`
      const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      slots.push({ label, value })
    }
  }
  return slots
}

const TIME_SLOTS = getTimeSlots()
const DAYS_60 = getNext60Days()

function getDurationText(pickupDate, pickupTime, dropoffDate, dropoffTime) {
  if (!pickupDate || !dropoffDate) return null
  const p = new Date(`${pickupDate}T${pickupTime || '10:00'}`)
  const d = new Date(`${dropoffDate}T${dropoffTime || '10:00'}`)
  const diffMs = d - p
  if (diffMs <= 0) return null
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  return `${days > 0 ? `${days} Day${days !== 1 ? 's' : ''} ` : ''}${hours} Hour${hours !== 1 ? 's' : ''}`
}

function getTotalHours(pickupDate, pickupTime, dropoffDate, dropoffTime) {
  const p = new Date(`${pickupDate}T${pickupTime || '10:00'}`)
  const d = new Date(`${dropoffDate}T${dropoffTime || '10:00'}`)
  return Math.max(2, Math.ceil((d - p) / (1000 * 60 * 60)))
}

import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import PageLayout from '../components/layout/PageLayout'
import Footer from '../components/layout/Footer'
import BookingSteps from '../components/sections/BookingSteps'
import { useBooking } from '../hooks/useBooking'
import { ROUTES } from '@/lib/constants'
import toast from 'react-hot-toast'
import { sendNotification } from '../lib/notificationHelper'
import { generateInvoice } from '../lib/invoiceGenerator'

// ── Date/Time helpers ─────────────────────────────────────────────────────────
function getNext60Days() {
  const days = []
  for (let i = 0; i < 60; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    days.push({
      label: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
      value: d.toISOString().slice(0, 10), // YYYY-MM-DD
    })
  }
  return days
}

function getTimeSlots() {
  const slots = []
  for (let h = 6; h <= 23; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h
      const ampm = h < 12 ? 'AM' : 'PM'
      const label = `${hour12}:${String(m).padStart(2, '0')} ${ampm}`
      const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      slots.push({ label, value })
    }
  }
  return slots
}

const TIME_SLOTS = getTimeSlots()
const DAYS_60 = getNext60Days()

function getDurationText(pickupDate, pickupTime, dropoffDate, dropoffTime) {
  if (!pickupDate || !dropoffDate) return null
  const p = new Date(`${pickupDate}T${pickupTime || '10:00'}`)
  const d = new Date(`${dropoffDate}T${dropoffTime || '10:00'}`)
  const diffMs = d - p
  if (diffMs <= 0) return null
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  return `${days > 0 ? `${days} Day${days !== 1 ? 's' : ''} ` : ''}${hours} Hour${hours !== 1 ? 's' : ''}`
}

function getTotalHours(pickupDate, pickupTime, dropoffDate, dropoffTime) {
  const p = new Date(`${pickupDate}T${pickupTime || '10:00'}`)
  const d = new Date(`${dropoffDate}T${dropoffTime || '10:00'}`)
  return Math.max(2, Math.ceil((d - p) / (1000 * 60 * 60)))
}

function getTotalDays(pickupDate, pickupTime, dropoffDate, dropoffTime) {
  const p = new Date(`${pickupDate}T${pickupTime || '10:00'}`)
  const d = new Date(`${dropoffDate}T${dropoffTime || '10:00'}`)
  return Math.max(1, Math.ceil((d - p) / (1000 * 60 * 60 * 24)))
}

// ── Payment methods (Razorpay-integrated) ─────────────────────────────────────

// ── Quick coupon chips ────────────────────────────────────────────────────────
const QUICK_COUPONS = ['FLEET10', 'NEWUSER', 'REFER20']

export default function BookingPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, userDoc } = useAuth()
  const [vehicle, setVehicle] = useState(null)
  const [loadingVehicle, setLoadingVehicle] = useState(true)

  const {
    step, nextStep: _nextStep, prevStep,
    paymentMethod, setPaymentMethod,
    addons,
    confirmed, bookingId, saving,
    saveBookingToFirestore,
    paymentSettings, getTokenAmount,
  } = useBooking()

  // ── Date/Time state ───────────────────────────────────────────────────────
  const today = DAYS_60[0].value
  const [pickupDate, setPickupDate] = useState(today)
  const [pickupTime, setPickupTime] = useState('10:00')
  const [dropoffDate, setDropoffDate] = useState(DAYS_60[3]?.value || today)
  const [dropoffTime, setDropoffTime] = useState('10:00')

  const adjustDate = (dateStr, delta) => {
    const d = new Date(dateStr)
    d.setDate(d.getDate() + delta)
    return d.toISOString().slice(0, 10)
  }

  const handlePickupDate = (val) => {
    setPickupDate(val)
    if (val >= dropoffDate) setDropoffDate(adjustDate(val, 1))
  }

  // ── Rental type ───────────────────────────────────────────────────────────
  const [rentalType, setRentalType] = useState('daily')

  // ── Location ─────────────────────────────────────────────────────────────
  const [location, setLocation] = useState('')
  const [locationLoading, setLocationLoading] = useState(false)

  useEffect(() => {
    if (vehicle?.location) setLocation(vehicle.location)
  }, [vehicle])

  const handleGetLocation = async () => {
    setLocationLoading(true)
    try {
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej))
      const { latitude, longitude } = pos.coords
      const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`)
      const data = await resp.json()
      const addr = data.display_name || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
      setLocation(addr)
      toast.success('Location detected!')
    } catch {
      toast.error('Could not get location. Please allow location access.')
    } finally {
      setLocationLoading(false)
    }
  }

  // ── Coupon ────────────────────────────────────────────────────────────────
  const [couponOpen, setCouponOpen] = useState(false)
  const [couponCode, setCouponCode] = useState('')
  const [couponData, setCouponData] = useState(null)
  const [couponError, setCouponError] = useState('')
  const [couponLoading, setCouponLoading] = useState(false)

  const applyCoupon = async (code) => {
    const c = (code || couponCode).trim().toUpperCase()
    if (!c) return
    setCouponLoading(true)
    setCouponError('')
    setCouponData(null)
    try {
      const snap = await getDoc(doc(db, 'coupons', c))
      if (!snap.exists()) {
        setCouponError('Invalid or expired coupon')
        return
      }
      const data = snap.data()
      if (!data.active) { setCouponError('This coupon has expired'); return }
      if (subtotal < (data.minAmount || 0)) {
        setCouponError(`Minimum order ₹${data.minAmount} required`)
        return
      }
      setCouponData({ ...data, code: c })
      setCouponCode(c)
      toast.success(`✅ ${c} applied — ${data.description}`)
    } catch (err) {
      console.error(err)
      setCouponError('Failed to verify coupon')
    } finally {
      setCouponLoading(false)
    }
  }

  const removeCoupon = () => { setCouponData(null); setCouponCode(''); setCouponError('') }

  // ── Fetch vehicle ─────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchVehicle = async () => {
      try {
        const snap = await getDoc(doc(db, 'vehicles', id))
        if (snap.exists()) {
          setVehicle({ id: snap.id, ...snap.data() })
        } else {
          navigate('/browse')
        }
      } catch {
        navigate('/browse')
      } finally {
        setLoadingVehicle(false)
      }
    }
    fetchVehicle()
  }, [id, navigate])

  // ── Pricing ───────────────────────────────────────────────────────────────
  const hours = getTotalHours(pickupDate, pickupTime, dropoffDate, dropoffTime)
  const days = getTotalDays(pickupDate, pickupTime, dropoffDate, dropoffTime)
  const durationText = getDurationText(pickupDate, pickupTime, dropoffDate, dropoffTime)

  const pricePerHour = vehicle?.pricePerHour || Math.round((vehicle?.dailyPrice || 0) / 8)
  const pricePerDay = vehicle?.dailyPrice || 0
  const pricePerMonth = vehicle?.pricePerMonth || (vehicle?.dailyPrice || 0) * 22

  const rentalCharge =
    rentalType === 'hourly'
      ? pricePerHour * hours
      : rentalType === 'daily'
      ? pricePerDay * days
      : pricePerMonth

  const insurance = addons?.insurance ? 1500 : 0
  const subtotal = rentalCharge + insurance
  const couponSavings = couponData
    ? couponData.type === 'percent'
      ? Math.round(subtotal * couponData.discount / 100)
      : couponData.discount
    : 0
  const afterCoupon = subtotal - couponSavings
  const gst = Math.round(afterCoupon * 0.18)
  const total = afterCoupon + gst

  const pricing = {
    days, hours, rentalType, rentalCharge, insurance, couponCode: couponData?.code,
    couponSavings, gst, total, subtotal,
    pickupDate, pickupTime, dropoffDate, dropoffTime, pickupLocation: location,
  }

  const handleConfirmBooking = async () => {
    if (!vehicle) return

    const bid = await saveBookingToFirestore(vehicle, pricing)
    if (bid) {
                      </div>
                      <div
                        onClick={() => setPaymentMethod(pm.id)}
                        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center cursor-pointer ${paymentMethod === pm.id ? 'border-primary' : 'border-outline-variant'}`}
                      >
                        {paymentMethod === pm.id && <div className="w-3 h-3 bg-primary rounded-full" />}
                      </div>
                    </label>
                  ))}
                </div>
              </section>

              <div className="flex items-center justify-between">
                <button
                  onClick={prevStep}
                  className="flex items-center gap-2 text-primary font-bold hover:gap-3 transition-all"
                >
                  <span className="material-symbols-outlined">arrow_back</span>
                  Back
                </button>
                <button
                  id="pay-btn"
                  onClick={handleConfirmBooking}
                  disabled={saving}
                  className="h-12 px-10 bg-primary-container text-white font-bold rounded-lg shadow-lg hover:shadow-xl active:scale-95 transition-all flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {saving ? 'Processing...' : paymentMethod === 'razorpay_token'
                    ? `Pay ₹${getTokenAmount(total).toLocaleString('en-IN')} & Book`
                    : paymentMethod === 'razorpay_full'
                    ? `Pay ₹${total.toLocaleString('en-IN')} & Book`
                    : `Confirm Booking · ₹${total.toLocaleString('en-IN')}`}
                  <span className="material-symbols-outlined">shield</span>
                </button>
              </div>
            </div>

            {/* ── Right: Summary ── */}
            <div className="lg:col-span-5 space-y-6">
              <div className="bg-surface-container-lowest p-6 rounded-xl shadow-soft sticky top-[100px]">
                <h3 className="font-headline-sm text-[20px] mb-5 border-b border-outline-variant pb-4">Booking Summary</h3>

                {/* Vehicle image */}
                <div className="relative h-40 mb-5 bg-gradient-to-b from-white to-surface-container-high rounded-xl overflow-hidden flex items-center justify-center">
                  <img alt={vehicle.name} className="w-4/5 h-auto object-contain z-10" src={vehicle.imageUrl} />
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-bold text-on-surface">{vehicle.name}</h4>
                      <p className="text-label-md text-secondary">{vehicle.fuelType} • {vehicle.seats} Seater</p>
                    </div>
                    {vehicle.badge && (
                      <span className="bg-on-surface text-white text-[12px] px-2 py-1 rounded font-bold uppercase">{vehicle.badge}</span>
                    )}
                  </div>

                  {/* Duration */}
                  <div className="flex justify-between py-3 border-y border-outline-variant text-label-md">
                    <div>
                      <p className="text-secondary">Duration</p>
                      <p className="font-bold">
                        {rentalType === 'monthly' ? '1 Month' :
                         rentalType === 'hourly' ? `${hours} Hour${hours !== 1 ? 's' : ''}` :
                         `${days} Day${days !== 1 ? 's' : ''}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-secondary">Type</p>
                      <p className="font-bold capitalize">{rentalType}</p>
                    </div>
                  </div>

                  {/* Price breakdown */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-label-md">
                      <span className="text-secondary">
                        {rentalType === 'monthly' ? 'Monthly rate' :
                         rentalType === 'hourly' ? `₹${pricePerHour}/hr × ${hours}hrs` :
                         `₹${pricePerDay}/day × ${days}d`}
                      </span>
                      <span>₹{rentalCharge.toLocaleString('en-IN')}</span>
                    </div>
                    {insurance > 0 && (
                      <div className="flex justify-between text-label-md">
                        <span className="text-secondary">Insurance</span>
                        <span>₹{insurance.toLocaleString('en-IN')}</span>
                      </div>
                    )}
                    {couponSavings > 0 && (
                      <div className="flex justify-between text-label-md text-green-600">
                        <span>Coupon ({couponData?.code})</span>
                        <span>−₹{couponSavings.toLocaleString('en-IN')}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-label-md">
                      <span className="text-secondary">GST (18%)</span>
                      <span>₹{gst.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex justify-between pt-3 border-t border-primary/20">
                      <span className="font-bold text-[22px]">Total</span>
                      <span className="font-bold text-[22px] text-primary">₹{total.toLocaleString('en-IN')}</span>
                    </div>
                  </div>

                  </div>

                {/* Protection */}
                <div className="mt-5 p-4 bg-green-50 border border-green-100 rounded-lg flex items-start gap-3">
                  <span className="material-symbols-outlined text-green-600" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                  <div>
                    <p className="text-label-md font-bold text-green-900">Fleet Protection Included</p>
                    <p className="text-[12px] text-green-700">Covered for accidental damage and 24/7 roadside assistance.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </PageLayout>
  )
}
