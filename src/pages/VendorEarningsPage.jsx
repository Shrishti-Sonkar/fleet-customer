import { useEffect, useState } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import PageLayout from '../components/layout/PageLayout'

export default function VendorEarningsPage() {
  const { user } = useAuth()
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    const q = query(
      collection(db, 'bookings'),
      where('ownerId', '==', user.uid),
      where('status', '==', 'completed')
    )
    return onSnapshot(q, (snap) => {
      setBookings(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
  }, [user])

  const totalEarnings = bookings.reduce((sum, b) => sum + (b.splitDetails?.vendorCut || b.pricing?.total || 0), 0)
  const pendingPayouts = bookings.filter(b => b.splitDetails?.transferStatus !== 'processed')
  const completedPayouts = bookings.filter(b => b.splitDetails?.transferStatus === 'processed')

  return (
    <PageLayout>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">Earnings</h1>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-5">
            <p className="text-label-md text-secondary">Total Earnings</p>
            <p className="text-2xl font-bold text-green-600 mt-1">₹{totalEarnings.toLocaleString('en-IN')}</p>
          </div>
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-5">
            <p className="text-label-md text-secondary">Completed Rides</p>
            <p className="text-2xl font-bold text-on-surface mt-1">{bookings.length}</p>
          </div>
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-5">
            <p className="text-label-md text-secondary">Pending Payouts</p>
            <p className="text-2xl font-bold text-yellow-600 mt-1">{pendingPayouts.length}</p>
          </div>
        </div>

        {/* Transaction List */}
        <h2 className="text-lg font-bold mb-4">Transaction History</h2>
        {loading ? (
          <div className="text-center py-12"><div className="w-8 h-8 border-3 border-primary-container border-t-transparent rounded-full animate-spin mx-auto" /></div>
        ) : bookings.length === 0 ? (
          <div className="text-center py-16 bg-surface-container-lowest border border-outline-variant rounded-2xl">
            <span className="material-symbols-outlined text-6xl text-secondary mb-4 block">account_balance_wallet</span>
            <p className="text-secondary">No completed rides yet. Earnings will appear here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {bookings.map(b => (
              <div key={b.id} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="font-bold text-on-surface">{b.vehicleName}</p>
                  <p className="text-label-md text-secondary">{b.bookingId} • {b.renterName}</p>
                  <p className="text-label-md text-secondary">{b.pickupDate} → {b.dropoffDate}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-green-600 text-lg">₹{(b.splitDetails?.vendorCut || b.pricing?.total || 0).toLocaleString('en-IN')}</p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    b.splitDetails?.transferStatus === 'processed' ? 'bg-green-100 text-green-700' :
                    b.splitDetails?.transferStatus === 'failed' ? 'bg-red-100 text-red-700' :
                    'bg-yellow-100 text-yellow-700'
                  }`}>
                    {b.splitDetails?.transferStatus === 'processed' ? 'SETTLED' :
                     b.splitDetails?.transferStatus === 'failed' ? 'FAILED' : 'PENDING'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  )
}
