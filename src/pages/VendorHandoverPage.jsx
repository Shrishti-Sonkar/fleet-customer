import { useState, useEffect } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import toast from 'react-hot-toast'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'
import { sendNotification } from '../lib/notificationHelper'
import TopNavBar from '../components/layout/TopNavBar'
import VendorNav from '../components/VendorNav'

const KYC_BADGE = {
  approved: { label: 'KYC Approved', cls: 'bg-emerald-100 text-emerald-700' },
  pending: { label: 'KYC Pending', cls: 'bg-amber-100 text-amber-700' },
  rejected: { label: 'KYC Rejected', cls: 'bg-red-100 text-red-700' },
  not_submitted: { label: 'KYC Not Submitted', cls: 'bg-slate-100 text-slate-500' },
}

// Single document tile — thumbnail that opens full-size, or an empty placeholder.
function DocTile({ label, url, onOpen }) {
  return (
    <div className="flex-1 min-w-0">
      <p className="mb-1 text-[11px] font-semibold text-slate-500">{label}</p>
      {url ? (
        <button
          type="button"
          onClick={() => onOpen(url)}
          className="block w-full aspect-[4/3] overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
        >
          <img src={url} alt={label} className="h-full w-full object-cover" />
        </button>
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-[11px] text-slate-400">
          Not uploaded
        </div>
      )}
    </div>
  )
}

export default function VendorHandoverPage() {
  const { user } = useAuth()
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [kyc, setKyc] = useState({})              // bookingId -> kyc data
  const [kycLoading, setKycLoading] = useState({}) // bookingId -> bool
  const [acting, setActing] = useState({})         // bookingId -> bool
  const [lightbox, setLightbox] = useState(null)   // image url

  useEffect(() => {
    if (!user) return
    const q = query(
      collection(db, 'bookings'),
      where('ownerId', '==', user.uid),
      where('status', 'in', ['pending', 'approved']),
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        rows.sort((a, b) => {
          const da = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0)
          const db2 = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0)
          return db2 - da
        })
        setBookings(rows)
        setLoading(false)
      },
      (err) => {
        console.error('Handover bookings error:', err)
        setLoading(false)
      },
    )
    return unsub
  }, [user])

  const loadKyc = async (booking) => {
    setKycLoading((s) => ({ ...s, [booking.id]: true }))
    try {
      const token = await user.getIdToken()
      const data = await apiFetch(`/api/bookings/${booking.id}/renter-kyc`, { token })
      setKyc((s) => ({ ...s, [booking.id]: data }))
    } catch (err) {
      console.error('Load KYC failed:', err)
      toast.error(err.message || 'Could not load customer KYC')
    } finally {
      setKycLoading((s) => ({ ...s, [booking.id]: false }))
    }
  }

  const approve = async (booking) => {
    setActing((s) => ({ ...s, [booking.id]: true }))
    try {
      const token = await user.getIdToken()
      await apiFetch(`/api/bookings/${booking.id}/approve`, { token, method: 'POST' })
      toast.success('Approved — handover code generated')
      sendNotification({
        userId: booking.renterId,
        type: 'booking_approved',
        title: 'Booking approved ✅',
        body: `Your ${booking.vehicleName} is ready. Enter your start code at pickup.`,
        actionUrl: '/my-bookings',
        bookingId: booking.id,
      }).catch(() => {})
    } catch (err) {
      console.error('Approve failed:', err)
      toast.error(err.message || 'Unable to approve booking')
    } finally {
      setActing((s) => ({ ...s, [booking.id]: false }))
    }
  }

  const reject = async (booking) => {
    if (!window.confirm(`Reject the booking for ${booking.renterName || 'this customer'}?`)) return
    setActing((s) => ({ ...s, [booking.id]: true }))
    try {
      const token = await user.getIdToken()
      await apiFetch(`/api/bookings/${booking.id}/reject`, { token, method: 'POST' })
      toast.success('Booking rejected')
      sendNotification({
        userId: booking.renterId,
        type: 'booking_rejected',
        title: 'Booking declined',
        body: `Your booking for ${booking.vehicleName} was declined by the host.`,
        actionUrl: '/my-bookings',
        bookingId: booking.id,
      }).catch(() => {})
    } catch (err) {
      console.error('Reject failed:', err)
      toast.error(err.message || 'Unable to reject booking')
    } finally {
      setActing((s) => ({ ...s, [booking.id]: false }))
    }
  }

  return (
    <div className="min-h-screen bg-slate-50" style={{ paddingBottom: 'calc(72px + env(safe-area-inset-bottom))' }}>
      <TopNavBar />

      <main className="max-w-2xl mx-auto px-4 pt-[84px] pb-8 space-y-4">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Customer Handover</p>
          <h1 className="text-2xl font-black text-slate-900 mt-0.5">Verify KYC &amp; hand over</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Check each customer&apos;s ID before giving them the vehicle.
          </p>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-40 rounded-2xl bg-white border border-slate-100 animate-pulse" />
            ))}
          </div>
        ) : bookings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
            <span className="mb-3 block text-4xl">🤝</span>
            <p className="mb-1 font-semibold text-slate-700">No bookings to hand over</p>
            <p className="text-sm text-slate-400">Pending and approved bookings will show up here.</p>
          </div>
        ) : (
          bookings.map((b) => {
            const k = kyc[b.id]
            const badge = KYC_BADGE[k?.kycStatus] || KYC_BADGE.not_submitted
            const isPending = b.status === 'pending'
            const busy = acting[b.id]
            const remaining = (b.pricing?.total || 0) - (b.amountPaid || 0)
            return (
              <div key={b.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                {/* Booking header */}
                <div className="flex items-start gap-3">
                  {b.vehicleImage ? (
                    <img src={b.vehicleImage} alt={b.vehicleName} className="h-14 w-14 rounded-xl object-cover" />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 text-xl">🏍️</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-bold text-slate-900">{b.vehicleName}</p>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${isPending ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                        {isPending ? 'Awaiting approval' : 'Approved'}
                      </span>
                    </div>
                    <p className="truncate text-sm font-semibold text-slate-700">{b.renterName || 'Customer'}</p>
                    <p className="text-xs text-slate-400">
                      {b.pickupDate} {b.pickupTime} → {b.dropoffDate} {b.dropoffTime}
                    </p>
                  </div>
                </div>

                {/* Payment Status */}
                <div className="mt-4">
                  {b.paymentStatus === 'paid' && (
                    <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 border border-emerald-100">
                      Full Payment Received ✓
                    </div>
                  )}
                  {b.paymentStatus === 'token_paid' && (
                    <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 border border-amber-100">
                      Partial Payment — Token ₹{b.tokenAmount || 0} received, ₹{remaining} pending
                    </div>
                  )}
                  {(b.paymentStatus === 'pending' || b.paymentStatus === 'pay_on_pickup') && (
                    <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 border border-slate-200">
                      Payment pending — Pay on pickup
                    </div>
                  )}
                </div>

                {/* KYC block */}
                <div className="mt-4">
                  {!k ? (
                    <button
                      type="button"
                      onClick={() => loadKyc(b)}
                      disabled={kycLoading[b.id]}
                      className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                    >
                      <span className="material-symbols-outlined text-[18px]">badge</span>
                      {kycLoading[b.id] ? 'Loading…' : 'View customer KYC'}
                    </button>
                  ) : (
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>{badge.label}</span>
                        {k.isVerified && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                            <span className="material-symbols-outlined text-[12px]">verified</span> Verified
                          </span>
                        )}
                        {k.phone && <span className="text-xs text-slate-500">📞 {k.phone}</span>}
                      </div>
                      <div className="flex gap-2">
                        <DocTile label="Aadhaar" url={k.aadhaarUrl} onOpen={setLightbox} />
                        <DocTile label="Driving Licence" url={k.dlUrl} onOpen={setLightbox} />
                        <DocTile label="Selfie" url={k.selfieUrl} onOpen={setLightbox} />
                      </div>
                      <p className="mt-2 text-[11px] text-slate-400">
                        Match the selfie and licence to the person before handing over.
                      </p>
                    </div>
                  )}
                </div>

                {/* Actions */}
                {isPending ? (
                  <div className="mt-4">
                    {b.paymentStatus === 'token_paid' && (
                      <p className="mb-2 text-center text-[11px] font-semibold text-amber-600">
                        Note: Full payment has not been received yet
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => approve(b)}
                        disabled={busy}
                        className="flex-1 rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                      >
                        {busy ? 'Working…' : 'Verify & Approve'}
                      </button>
                      <button
                        type="button"
                        onClick={() => reject(b)}
                        disabled={busy}
                        className="rounded-full border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : b.paymentStatus !== 'paid' && b.paymentStatus !== 'pay_on_pickup' ? (
                  <div className="mt-4 rounded-xl bg-red-50 border border-red-100 p-4 text-center">
                    <span className="material-symbols-outlined text-red-500 mb-1">block</span>
                    <p className="text-sm font-bold text-red-800">Payment Pending</p>
                    <p className="text-xs text-red-700 mt-1">
                      Ride cannot start until full payment is received. Customer must pay remaining ₹{remaining} from their My Bookings page.
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-center">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Handover code</p>
                    <p className="my-0.5 text-3xl font-black tracking-[0.3em] text-emerald-800">{b.startOTP || '••••'}</p>
                    <p className="text-[11px] text-emerald-700/80">
                      Hand over the vehicle. {b.renterName || 'The customer'} enters this code in their app to start the ride.
                    </p>
                  </div>
                )}
              </div>
            )
          })
        )}
      </main>

      {/* Full-size document viewer */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="Document" className="max-h-[90vh] max-w-full rounded-lg object-contain" />
          <button
            type="button"
            className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-900"
            onClick={() => setLightbox(null)}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      )}

      <VendorNav />
    </div>
  )
}
