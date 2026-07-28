import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'
import { apiFetch } from '../lib/api'

export function useBooking() {
  const { user, userDoc } = useAuth()
  const [step, setStep] = useState(1)
  const [pickupDate, setPickupDate] = useState('')
  const [dropoffDate, setDropoffDate] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('razorpay_full')
  const [addons, setAddons] = useState({ helmet: true, insurance: false })
  const [confirmed, setConfirmed] = useState(false)
  const [bookingId, setBookingId] = useState('')
  const [saving, setSaving] = useState(false)
  const [paymentSettings, setPaymentSettings] = useState(null)

  // Fetch payment settings on mount
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        if (!user) return
        const token = await user.getIdToken()
        const data = await apiFetch('/api/admin/payment-settings', { token })
        setPaymentSettings(data)
      } catch {
        // Use defaults if settings not available
        setPaymentSettings({
          tokenAmountType: 'fixed',
          tokenFixedAmount: 500,
          tokenPercentage: 20,
          platformCommissionPercent: 15,
        })
      }
    }
    fetchSettings()
  }, [user])

  const nextStep = () => setStep((s) => Math.min(s + 1, 4))
  const prevStep = () => setStep((s) => Math.max(s - 1, 1))
  const toggleAddon = (key) => setAddons((prev) => ({ ...prev, [key]: !prev[key] }))

  const getTokenAmount = (totalAmount) => {
    if (!paymentSettings) return 500
    if (paymentSettings.tokenAmountType === 'percentage') {
      return Math.round(totalAmount * paymentSettings.tokenPercentage / 100)
    }
    return Math.min(paymentSettings.tokenFixedAmount || 500, totalAmount)
  }

  const buildBookingDetails = (vehicle, pricing) => {
    if (!user || !vehicle) return null

    return {
      renterId: user.uid,
      renterName: userDoc?.name || user.displayName || 'Guest',
      renterEmail: user.email || '',
      vehicleId: vehicle.id,
      vehicleName: vehicle.name,
      vehicleImage: vehicle.imageUrl || vehicle.images?.[0] || '',
      ownerId: vehicle.ownerId || '',
      pickupDate: pricing.pickupDate || pickupDate,
      dropoffDate: pricing.dropoffDate || dropoffDate,
      pickupTime: pricing.pickupTime || '10:00',
      dropoffTime: pricing.dropoffTime || '10:00',
      pickupLocation: pricing.pickupLocation || vehicle.location || '',
      rentalType: pricing.rentalType || 'daily',
      couponCode: pricing.couponCode || null,
      addons,
      city: vehicle.city || '',
      paymentMethod,
    }
  }

  const openRazorpayCheckout = (orderData, onSuccess) => {
    return new Promise((resolve, reject) => {
      if (typeof window.Razorpay === 'undefined') {
        toast.error('Payment gateway not loaded. Please refresh and try again.')
        reject(new Error('Razorpay not loaded'))
        return
      }

      const options = {
        key: orderData.keyId,
        amount: orderData.amountInPaise,
        currency: orderData.currency || 'INR',
        name: 'Fleet',
        description: `Booking ${orderData.bookingPublicId || ''}`,
        order_id: orderData.orderId,
        prefill: {
          name: userDoc?.name || user?.displayName || '',
          email: user?.email || '',
          contact: userDoc?.phone || '',
        },
        theme: {
          color: '#1a1a1a',
        },
        handler: async (response) => {
          try {
            const token = await user.getIdToken()
            const verifyResult = await apiFetch('/api/payments/verify', {
              token,
              method: 'POST',
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                bookingId: orderData.bookingId,
                paymentType: orderData.paymentType,
              }),
            })
            if (onSuccess) onSuccess(verifyResult)
            resolve(verifyResult)
          } catch (err) {
            toast.error('Payment verification failed: ' + (err.message || 'Unknown error'))
            reject(err)
          }
        },
        modal: {
          ondismiss: () => {
            toast('Payment cancelled', { icon: '⚠️' })
            reject(new Error('Payment cancelled'))
          },
        },
      }

      const rzp = new window.Razorpay(options)
      rzp.on('payment.failed', (response) => {
        toast.error('Payment failed: ' + (response.error?.description || 'Unknown error'))
        reject(new Error(response.error?.description || 'Payment failed'))
      })
      rzp.open()
    })
  }

  const saveBookingToFirestore = async (vehicle, pricing) => {
    if (!user || !vehicle) return null

    setSaving(true)
    try {
      const token = await user.getIdToken()

      // Step 1: Create booking
      const bookingData = await apiFetch('/api/bookings/create', {
        token,
        method: 'POST',
        body: JSON.stringify({
          bookingDetails: buildBookingDetails(vehicle, pricing),
        }),
      })

      const createdBookingId = bookingData.id || bookingData.bookingId

      // Step 2: If Razorpay payment method, create order and open checkout
      if (paymentMethod === 'razorpay_full' || paymentMethod === 'razorpay_token') {
        const paymentType = paymentMethod === 'razorpay_token' ? 'token' : 'full'

        const orderData = await apiFetch('/api/payments/create-order', {
          token,
          method: 'POST',
          body: JSON.stringify({
            bookingId: createdBookingId,
            paymentType,
          }),
        })

        try {
          await openRazorpayCheckout(
            { ...orderData, paymentType },
            (verifyResult) => {
              setBookingId(bookingData.bookingId)
              setConfirmed(true)
              setStep(4)
              const msg = verifyResult.paymentStatus === 'paid'
                ? 'Payment successful! Booking confirmed.'
                : `Token of ₹${verifyResult.amountPaid?.toLocaleString('en-IN')} paid! Remaining ₹${verifyResult.remainingAmount?.toLocaleString('en-IN')} due at pickup.`
              toast.success(msg)
            }
          )
          return bookingData.bookingId
        } catch {
          // Payment cancelled or failed — booking still exists as pending
          toast('Booking created but payment pending. You can pay later from My Bookings.', { icon: 'ℹ️', duration: 5000 })
          setBookingId(bookingData.bookingId)
          setConfirmed(true)
          setStep(4)
          return bookingData.bookingId
        }
      } else {
        // Pay on pickup — no Razorpay needed
        setBookingId(bookingData.bookingId)
        setConfirmed(true)
        setStep(4)
        toast.success('Booking confirmed! Pay at pickup.')
        return bookingData.bookingId
      }
    } catch (err) {
      console.error('Booking save error:', err)
      toast.error(err.message || 'Booking failed. Please try again.')
      return null
    } finally {
      setSaving(false)
    }
  }

  const payRemainingBalance = async (bookingFirestoreId) => {
    if (!user) return null
    try {
      const token = await user.getIdToken()
      const orderData = await apiFetch('/api/payments/create-order', {
        token,
        method: 'POST',
        body: JSON.stringify({
          bookingId: bookingFirestoreId,
          paymentType: 'remaining',
        }),
      })

      const result = await openRazorpayCheckout(
        { ...orderData, paymentType: 'remaining' },
        () => toast.success('Full payment completed! Vehicle is ready for pickup.')
      )
      return result
    } catch (err) {
      console.error('Pay remaining error:', err)
      return null
    }
  }

  const confirmBooking = () => {
    setConfirmed(true)
    setStep(4)
  }

  return {
    step,
    nextStep,
    prevStep,
    pickupDate,
    setPickupDate,
    dropoffDate,
    setDropoffDate,
    paymentMethod,
    setPaymentMethod,
    addons,
    toggleAddon,
    confirmed,
    bookingId,
    saving,
    confirmBooking,
    saveBookingToFirestore,
    buildBookingDetails,
    paymentSettings,
    getTokenAmount,
    openRazorpayCheckout,
    payRemainingBalance,
  }
}
