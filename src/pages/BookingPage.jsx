import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { collection, doc, getDoc } from 'firebase/firestore'
import toast from 'react-hot-toast'
import BookingSteps from '../components/sections/BookingSteps'
import PageLayout from '../components/layout/PageLayout'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import { useBooking } from '../hooks/useBooking'
import { ROUTES } from '../lib/constants'

const PAYMENT_METHODS = [
  {
    id: 'razorpay_full',
    icon: 'credit_card',
    label: 'Pay in full',
    sub: 'Secure payment through Razorpay',
  },
  {
    id: 'razorpay_token',
    icon: 'account_balance_wallet',
    label: 'Pay token now',
    sub: 'Pay the balance at pickup',
  },
  {
    id: 'pay_on_pickup',
    icon: 'payments',
    label: 'Pay on pickup',
    sub: 'Pay when you collect the vehicle',
  },
]

function getToday() {
  return new Date().toISOString().slice(0, 10)
}

function getDuration(pickupDate, pickupTime, dropoffDate, dropoffTime) {
  if (!pickupDate || !dropoffDate) return { hours: 2, days: 1, text: '1 day' }

  const start = new Date(`${pickupDate}T${pickupTime || '10:00'}:00+05:30`)
  const end = new Date(`${dropoffDate}T${dropoffTime || '10:00'}:00+05:30`)
  const diff = end.getTime() - start.getTime()
  const hours = Math.max(2, Math.ceil(diff / (1000 * 60 * 60)))
  const days = Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)))

  if (diff <= 0) return { hours: 2, days: 1, text: 'Choose a later drop-off' }
  return {
    hours,
    days,
    text: `${days} day${days === 1 ? '' : 's'} · ${hours} hour${hours === 1 ? '' : 's'}`,
  }
}

export default function BookingPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [vehicle, setVehicle] = useState(null)
  const [loadingVehicle, setLoadingVehicle] = useState(true)
  const [pickupDate, setPickupDate] = useState(getToday())
  const [dropoffDate, setDropoffDate] = useState('')
  const [pickupTime, setPickupTime] = useState('10:00')
  const [dropoffTime, setDropoffTime] = useState('10:00')
  const [rentalType, setRentalType] = useState('daily')
  const [location, setLocation] = useState('')
  const [locationLoading, setLocationLoading] = useState(false)
  const [couponCode, setCouponCode] = useState('')
  const [couponData, setCouponData] = useState(null)
  const [couponLoading, setCouponLoading] = useState(false)
  const [couponError, setCouponError] = useState('')

  const {
    step,
    nextStep,
    prevStep,
    paymentMethod,
    setPaymentMethod,
    addons,
    toggleAddon,
    confirmed,
    bookingId,
    saving,
    saveBookingToFirestore,
    getTokenAmount,
  } = useBooking()

  useEffect(() => {
    let cancelled = false

    async function loadVehicle() {
      try {
        const snapshot = await getDoc(doc(db, 'vehicles', id))
        if (cancelled) return
        if (!snapshot.exists()) {
          navigate(ROUTES.BROWSE, { replace: true })
          return
        }
        const data = { id: snapshot.id, ...snapshot.data() }
        setVehicle(data)
        setLocation(data.location || '')
        setDropoffDate((current) => current || new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10))
      } catch (error) {
        console.error('Unable to load vehicle:', error)
        toast.error('Unable to load this vehicle.')
        navigate(ROUTES.BROWSE, { replace: true })
      } finally {
        if (!cancelled) setLoadingVehicle(false)
      }
    }

    if (id) loadVehicle()
    return () => { cancelled = true }
  }, [id, navigate])

  const duration = useMemo(
    () => getDuration(pickupDate, pickupTime, dropoffDate, dropoffTime),
    [pickupDate, pickupTime, dropoffDate, dropoffTime],
  )

  const pricing = useMemo(() => {
    const dailyPrice = Number(vehicle?.dailyPrice || 0)
    const hourlyPrice = Number(vehicle?.pricePerHour || Math.round(dailyPrice / 8))
    const monthlyPrice = Number(vehicle?.pricePerMonth || dailyPrice * 22)
    const rentalCharge = rentalType === 'hourly'
      ? hourlyPrice * duration.hours
      : rentalType === 'monthly'
        ? monthlyPrice
        : dailyPrice * duration.days
    const insurance = addons.insurance ? 1500 : 0
    const subtotal = rentalCharge + insurance
    const couponSavings = couponData
      ? couponData.type === 'percent'
        ? Math.round(subtotal * Number(couponData.discount || 0) / 100)
        : Number(couponData.discount || 0)
      : 0
    const afterCoupon = Math.max(0, subtotal - couponSavings)
    const gst = Math.round(afterCoupon * 0.18)

    return {
      days: duration.days,
      hours: duration.hours,
      rentalType,
      rentalCharge,
      insurance,
      couponCode: couponData?.code || null,
      couponSavings: Math.min(couponSavings, subtotal),
      gst,
      subtotal,
      total: afterCoupon + gst,
      pickupDate,
      pickupTime,
      dropoffDate,
      dropoffTime,
      pickupLocation: location.trim(),
    }
  }, [addons.insurance, couponData, dropoffDate, dropoffTime, duration, location, pickupDate, pickupTime, rentalType, vehicle])

  const applyCoupon = async () => {
    const code = couponCode.trim().toUpperCase()
    if (!code) return

    setCouponLoading(true)
    setCouponError('')
    try {
      const snapshot = await getDoc(doc(collection(db, 'coupons'), code))
      if (!snapshot.exists() || !snapshot.data().active) {
        setCouponData(null)
        setCouponError('Invalid or expired coupon.')
        return
      }
      const data = { code, ...snapshot.data() }
      if (pricing.subtotal < Number(data.minAmount || 0)) {
        setCouponData(null)
        setCouponError(`Minimum order is ₹${Number(data.minAmount).toLocaleString('en-IN')}.`)
        return
      }
      setCouponData(data)
      toast.success(`${code} applied.`)
    } catch (error) {
      console.error('Coupon lookup failed:', error)
      setCouponError('Unable to verify this coupon.')
    } finally {
      setCouponLoading(false)
    }
  }

  const handleGetLocation = async () => {
    if (!navigator.geolocation) {
      toast.error('Location is not supported by this browser.')
      return
    }
    setLocationLoading(true)
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
      })
      const { latitude, longitude } = position.coords
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`)
      const data = await response.json()
      setLocation(data.display_name || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`)
    } catch {
      toast.error('Could not determine your location.')
    } finally {
      setLocationLoading(false)
    }
  }

  const handleConfirmBooking = async () => {
    if (!vehicle || !dropoffDate || duration.text === 'Choose a later drop-off') {
      toast.error('Choose valid pickup and drop-off dates.')
      return
    }
    if (!location.trim()) {
      toast.error('Enter a pickup location.')
      return
    }

    const createdBookingId = await saveBookingToFirestore(vehicle, pricing)
    if (createdBookingId) nextStep()
  }

  if (loadingVehicle) {
    return <div className="min-h-screen flex items-center justify-center bg-surface-container-lowest"><div className="w-12 h-12 border-4 border-primary-container border-t-transparent rounded-full animate-spin" /></div>
  }

  if (!vehicle) return null

  if (confirmed) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white/95 px-6">
        <div className="text-center max-w-xl">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6 text-green-600 text-4xl">✓</div>
          <h1 className="font-headline-md text-3xl mb-3">Booking created</h1>
          <p className="text-secondary mb-2">Your {vehicle.name} booking is awaiting vendor approval.</p>
          <p className="text-label-md text-secondary mb-8">Booking ID: <span className="font-bold text-primary">{bookingId}</span></p>
          <div className="flex flex-wrap justify-center gap-3">
            <button onClick={() => navigate(ROUTES.HOME)} className="h-12 px-7 bg-on-surface text-white font-bold rounded-lg">Go home</button>
            <Link to={ROUTES.MY_BOOKINGS} className="inline-flex h-12 px-7 border-2 border-primary text-primary font-bold rounded-lg items-center">My bookings</Link>
          </div>
        </div>
      </div>
    )
  }

  const vehicleImage = vehicle.imageUrl || vehicle.images?.[0]
  const tokenAmount = getTokenAmount(pricing.total)

  return (
    <PageLayout showBottomBar={false}>
      <header className="fixed top-0 w-full h-[68px] bg-surface-container-lowest border-b border-outline-variant z-50">
        <div className="flex items-center justify-between px-gutter max-w-screen-2xl mx-auto h-full">
          <Link to={ROUTES.HOME} className="font-headline-sm text-headline-sm font-black text-primary">Fleet</Link>
          <span className="text-on-surface-variant font-label-md">Secure checkout</span>
        </div>
      </header>

      <main className="pt-[100px] pb-section-padding-lg">
        <div className="max-w-5xl mx-auto px-gutter">
          <BookingSteps currentStep={step} />
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-7 space-y-6">
              <section className="bg-surface-container-lowest p-6 rounded-xl shadow-soft">
                <h2 className="font-headline-sm text-headline-sm mb-4">Rental type</h2>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ['hourly', 'Hourly'],
                    ['daily', 'Daily'],
                    ['monthly', 'Monthly'],
                  ].map(([value, label]) => (
                    <button key={value} onClick={() => setRentalType(value)} className={`py-3 rounded-lg font-bold ${rentalType === value ? 'bg-primary-container text-white' : 'bg-surface-container text-secondary'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="bg-surface-container-lowest p-6 rounded-xl shadow-soft">
                <h2 className="font-headline-sm text-headline-sm mb-4">Dates and times</h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  <label className="text-label-md font-bold">Pickup
                    <input type="date" min={getToday()} value={pickupDate} onChange={(event) => setPickupDate(event.target.value)} className="mt-2 w-full h-11 px-3 rounded-xl border border-outline-variant bg-white" />
                    <input type="time" value={pickupTime} onChange={(event) => setPickupTime(event.target.value)} className="mt-2 w-full h-11 px-3 rounded-xl border border-outline-variant bg-white" />
                  </label>
                  <label className="text-label-md font-bold">Drop-off
                    <input type="date" min={pickupDate} value={dropoffDate} onChange={(event) => setDropoffDate(event.target.value)} className="mt-2 w-full h-11 px-3 rounded-xl border border-outline-variant bg-white" />
                    <input type="time" value={dropoffTime} onChange={(event) => setDropoffTime(event.target.value)} className="mt-2 w-full h-11 px-3 rounded-xl border border-outline-variant bg-white" />
                  </label>
                </div>
                <p className="mt-4 text-primary font-bold">{duration.text}</p>
              </section>

              <section className="bg-surface-container-lowest p-6 rounded-xl shadow-soft">
                <h2 className="font-headline-sm text-headline-sm mb-4">Pickup location</h2>
                <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Enter pickup address" className="w-full h-11 px-4 rounded-xl border border-outline-variant bg-white" />
                <button onClick={handleGetLocation} disabled={locationLoading} className="mt-3 h-10 px-4 border border-primary text-primary rounded-xl font-bold disabled:opacity-50">{locationLoading ? 'Locating…' : 'Use current location'}</button>
              </section>

              <section className="bg-surface-container-lowest p-6 rounded-xl shadow-soft">
                <h2 className="font-headline-sm text-headline-sm mb-4">Add-ons</h2>
                <label className="flex items-center justify-between py-2"><span>Helmet</span><input type="checkbox" checked={!!addons.helmet} onChange={() => toggleAddon('helmet')} /></label>
                <label className="flex items-center justify-between py-2"><span>Insurance <span className="text-secondary">(₹1,500)</span></span><input type="checkbox" checked={!!addons.insurance} onChange={() => toggleAddon('insurance')} /></label>
              </section>

              <section className="bg-surface-container-lowest p-6 rounded-xl shadow-soft">
                <h2 className="font-headline-sm text-headline-sm mb-4">Coupon</h2>
                <div className="flex gap-2">
                  <input value={couponCode} onChange={(event) => setCouponCode(event.target.value.toUpperCase())} placeholder="Coupon code" className="flex-1 h-11 px-4 rounded-xl border border-outline-variant bg-white uppercase" />
                  <button onClick={applyCoupon} disabled={couponLoading} className="h-11 px-4 rounded-xl bg-on-surface text-white font-bold disabled:opacity-50">Apply</button>
                </div>
                {couponData && <p className="mt-2 text-green-700 font-bold">{couponData.code} applied.</p>}
                {couponError && <p className="mt-2 text-red-600">{couponError}</p>}
              </section>

              <section className="bg-surface-container-lowest p-6 rounded-xl shadow-soft">
                <h2 className="font-headline-sm text-headline-sm mb-4">Payment</h2>
                <div className="space-y-3">
                  {PAYMENT_METHODS.map((method) => (
                    <label key={method.id} className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer ${paymentMethod === method.id ? 'border-primary bg-primary/5' : 'border-outline-variant'}`}>
                      <input type="radio" name="paymentMethod" value={method.id} checked={paymentMethod === method.id} onChange={() => setPaymentMethod(method.id)} />
                      <span className="material-symbols-outlined">{method.icon}</span>
                      <span><span className="block font-bold">{method.label}</span><span className="text-sm text-secondary">{method.sub}</span></span>
                    </label>
                  ))}
                </div>
              </section>

              <div className="flex items-center justify-between">
                <button onClick={prevStep} className="text-primary font-bold">Back</button>
                <button onClick={handleConfirmBooking} disabled={saving} className="h-12 px-7 bg-primary-container text-white font-bold rounded-lg disabled:opacity-60">
                  {saving ? 'Processing…' : paymentMethod === 'razorpay_token' ? `Pay ₹${tokenAmount.toLocaleString('en-IN')} and book` : `Confirm · ₹${pricing.total.toLocaleString('en-IN')}`}
                </button>
              </div>
            </div>

            <aside className="lg:col-span-5 bg-surface-container-lowest p-6 rounded-xl shadow-soft sticky top-[100px]">
              <h2 className="font-headline-sm text-headline-sm mb-4">Booking summary</h2>
              {vehicleImage && <img src={vehicleImage} alt={vehicle.name} className="w-full h-40 object-contain rounded-xl bg-surface-container mb-4" />}
              <h3 className="font-bold text-lg">{vehicle.name}</h3>
              <p className="text-secondary mb-5">{vehicle.city || vehicle.location || 'Fleet vehicle'}</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span>Rental</span><span>₹{pricing.rentalCharge.toLocaleString('en-IN')}</span></div>
                <div className="flex justify-between"><span>Insurance</span><span>₹{pricing.insurance.toLocaleString('en-IN')}</span></div>
                <div className="flex justify-between"><span>Coupon</span><span>-₹{pricing.couponSavings.toLocaleString('en-IN')}</span></div>
                <div className="flex justify-between"><span>GST</span><span>₹{pricing.gst.toLocaleString('en-IN')}</span></div>
                <div className="flex justify-between border-t border-outline-variant pt-3 mt-3 text-base font-bold"><span>Total</span><span>₹{pricing.total.toLocaleString('en-IN')}</span></div>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </PageLayout>
  )
}
