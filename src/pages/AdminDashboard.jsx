import { useEffect, useState } from 'react'
import {
  collection, query, onSnapshot, updateDoc, doc, orderBy, where,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import PageLayout from '../components/layout/PageLayout'
import toast from 'react-hot-toast'
import { sendNotification } from '../lib/notificationHelper'

const tabs = ['Overview', 'KYC Requests', 'All Bookings', 'All Vehicles', 'Users', 'Payments']

const kycStatusColors = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  not_submitted: 'bg-surface-container text-secondary',
}

const bookingStatusColors = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  completed: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-red-100 text-red-800',
}

export default function AdminDashboard() {
  const { userDoc } = useAuth()
  const [activeTab, setActiveTab] = useState('Overview')
  const [kycRequests, setKycRequests] = useState([])
  const [allBookings, setAllBookings] = useState([])
  const [allVehicles, setAllVehicles] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubKyc = onSnapshot(
      query(collection(db, 'verificationRequests'), orderBy('submittedAt', 'desc')),
      (snap) => setKycRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    )
    const unsubBookings = onSnapshot(
      query(collection(db, 'bookings'), orderBy('createdAt', 'desc')),
      (snap) => setAllBookings(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    )
    const unsubVehicles = onSnapshot(
      collection(db, 'vehicles'),
      (snap) => setAllVehicles(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    )
    const unsubUsers = onSnapshot(
      collection(db, 'users'),
      (snap) => {
        setAllUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        setLoading(false)
      },
    )
    return () => {
      unsubKyc()
      unsubBookings()
      unsubVehicles()
      unsubUsers()
    }
  }, [])

  const approveKyc = async (userId) => {
    await updateDoc(doc(db, 'verificationRequests', userId), { status: 'approved' })
    await updateDoc(doc(db, 'users', userId), {
      kycStatus: 'approved',
      isVerified: true,
      verifiedBadge: true,
    })
    toast.success('KYC approved!')
    await sendNotification({
      userId,
      type: 'kyc_approved',
      title: 'ID Verified ✅',
      body: 'Your documents are approved. You can now book any vehicle on Fleet.',
      actionUrl: '/browse',
    })
  }

  const rejectKyc = async (userId) => {
    await updateDoc(doc(db, 'verificationRequests', userId), { status: 'rejected' })
    await updateDoc(doc(db, 'users', userId), { kycStatus: 'rejected' })
    toast.success('KYC rejected.')
    await sendNotification({
      userId,
      type: 'kyc_rejected',
      title: 'KYC Rejected',
      body: 'Your documents could not be verified. Please re-upload clear photos.',
      actionUrl: '/profile',
    })
  }

  const toggleVehicleStatus = async (vehicleId, current) => {
    await updateDoc(doc(db, 'vehicles', vehicleId), {
      status: current === 'active' ? 'inactive' : 'active',
    })
    toast.success('Vehicle status updated.')
  }

  const pendingKyc = kycRequests.filter((r) => r.status === 'pending').length

  return (
    <PageLayout>
      <div className="max-w-screen-xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-primary-container" style={{ fontVariationSettings: "'FILL' 1" }}>admin_panel_settings</span>
            <h1 className="text-2xl font-bold text-on-surface">Admin Dashboard</h1>
          </div>
          <p className="text-secondary text-label-md">Manage Fleet platform — KYC, bookings, vehicles, users</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-8 bg-surface-container p-1 rounded-xl flex-wrap">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-2 rounded-lg text-label-md font-medium transition-all relative ${
                activeTab === t
                  ? 'bg-surface-container-lowest text-on-surface shadow-soft font-bold'
                  : 'text-secondary hover:text-on-surface'
              }`}
            >
              {t}
              {t === 'KYC Requests' && pendingKyc > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 bg-error text-white text-[10px] font-bold rounded-full">
                  {pendingKyc}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Overview */}
        {activeTab === 'Overview' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total Users', value: allUsers.length, icon: 'people', color: 'bg-blue-50 text-blue-600' },
              { label: 'KYC Pending', value: pendingKyc, icon: 'pending_actions', color: 'bg-yellow-50 text-yellow-600' },
              { label: 'Total Vehicles', value: allVehicles.length, icon: 'directions_car', color: 'bg-green-50 text-green-600' },
              { label: 'Total Bookings', value: allBookings.length, icon: 'confirmation_number', color: 'bg-orange-50 text-orange-600' },
            ].map(({ label, value, icon, color }) => (
              <div key={label} className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-5">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${color}`}>
                  <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>{icon}</span>
                </div>
                <p className="text-label-md text-secondary">{label}</p>
                <p className="text-2xl font-bold text-on-surface mt-1">{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* KYC Requests */}
        {activeTab === 'KYC Requests' && (
          <div className="space-y-4">
            {kycRequests.length === 0 ? (
              <div className="text-center py-16 bg-surface-container-lowest border border-outline-variant rounded-2xl">
                <span className="material-symbols-outlined text-6xl text-secondary mb-4 block">verified_user</span>
                <p className="text-secondary">No KYC requests yet.</p>
              </div>
            ) : (
              kycRequests.map((r) => (
                <div key={r.id} className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-5">
                  <div className="flex items-start justify-between flex-wrap gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-bold text-on-surface">{r.userName}</h3>
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${kycStatusColors[r.status] || ''}`}>
                          {r.status?.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-label-md text-secondary">{r.email} • {r.phone}</p>
                      <div className="flex gap-3 mt-4 flex-wrap">
                        {r.aadhaarUrl && (
                          <a href={r.aadhaarUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-label-md text-primary underline">
                            <span className="material-symbols-outlined text-[16px]">badge</span>Aadhaar
                          </a>
                        )}
                        {r.dlUrl && (
                          <a href={r.dlUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-label-md text-primary underline">
                            <span className="material-symbols-outlined text-[16px]">drive_eta</span>DL
                          </a>
                        )}
                        {r.selfieUrl && (
                          <a href={r.selfieUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-label-md text-primary underline">
                            <span className="material-symbols-outlined text-[16px]">face</span>Selfie
                          </a>
                        )}
                      </div>
                    </div>
                    {r.status === 'pending' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => approveKyc(r.id)}
                          className="h-9 px-4 bg-green-600 text-white rounded-lg font-bold text-label-md hover:opacity-90 active:scale-95 transition-all"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => rejectKyc(r.id)}
                          className="h-9 px-4 bg-error text-white rounded-lg font-bold text-label-md hover:opacity-90 active:scale-95 transition-all"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* All Bookings */}
        {activeTab === 'All Bookings' && (
          <div className="space-y-3">
            {allBookings.length === 0 ? (
              <div className="text-center py-16 bg-surface-container-lowest border border-outline-variant rounded-2xl">
                <span className="material-symbols-outlined text-6xl text-secondary mb-4 block">calendar_month</span>
                <p className="text-secondary">No bookings yet.</p>
              </div>
            ) : (
              allBookings.map((b) => (
                <div key={b.id} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-bold text-on-surface text-label-md">{b.bookingId}</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${bookingStatusColors[b.status] || ''}`}>
                        {b.status?.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-label-md text-secondary">{b.vehicleName} • {b.renterName}</p>
                    <p className="text-label-md text-secondary">{b.pickupDate} → {b.dropoffDate}</p>
                  </div>
                  <p className="font-bold text-on-surface">₹{b.pricing?.total?.toLocaleString('en-IN')}</p>
                </div>
              ))
            )}
          </div>
        )}

        {/* All Vehicles */}
        {activeTab === 'All Vehicles' && (
          <div className="space-y-3">
            {allVehicles.length === 0 ? (
              <div className="text-center py-16 bg-surface-container-lowest border border-outline-variant rounded-2xl">
                <span className="material-symbols-outlined text-6xl text-secondary mb-4 block">directions_car</span>
                <p className="text-secondary">No vehicles listed yet.</p>
              </div>
            ) : (
              allVehicles.map((v) => (
                <div key={v.id} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <p className="font-bold text-on-surface">{v.name}</p>
                    <p className="text-label-md text-secondary">{v.city} • {v.type} • ₹{v.dailyPrice}/day</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${v.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {v.status?.toUpperCase() || 'ACTIVE'}
                    </span>
                    <button
                      onClick={() => toggleVehicleStatus(v.id, v.status || 'active')}
                      className="h-8 px-3 border border-outline-variant rounded-lg text-label-md hover:bg-surface-container transition-all"
                    >
                      {v.status === 'inactive' ? 'Activate' : 'Deactivate'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Users */}
        {activeTab === 'Users' && (
          <div className="space-y-3">
            {allUsers.length === 0 ? (
              <div className="text-center py-16 bg-surface-container-lowest border border-outline-variant rounded-2xl">
                <span className="material-symbols-outlined text-6xl text-secondary mb-4 block">people</span>
                <p className="text-secondary">No users yet.</p>
              </div>
            ) : (
              allUsers.map((u) => (
                <div key={u.id} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-bold text-on-surface">{u.name || 'Unknown'}</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : u.role === 'owner' ? 'bg-blue-100 text-blue-700' : 'bg-surface-container text-secondary'}`}>
                        {u.role?.toUpperCase() || 'RENTER'}
                      </span>
                    </div>
                    <p className="text-label-md text-secondary">{u.email}</p>
                  </div>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${kycStatusColors[u.kycStatus] || ''}`}>
                    KYC: {u.kycStatus?.replace('_', ' ').toUpperCase() || 'UNKNOWN'}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {/* Payments */}
        {activeTab === 'Payments' && (() => {
          const paidBookings = allBookings.filter(b => b.paymentStatus === 'paid')
          const tokenPaidBookings = allBookings.filter(b => b.paymentStatus === 'token_paid')
          const pendingBookings = allBookings.filter(b => !b.paymentStatus || b.paymentStatus === 'pending' || b.paymentStatus === 'pay_on_pickup')
          const totalRevenue = paidBookings.reduce((s, b) => s + (b.pricing?.total || 0), 0)
          const platformEarnings = paidBookings.reduce((s, b) => s + (b.splitDetails?.platformCut || 0), 0)
          const vendorPayouts = paidBookings.reduce((s, b) => s + (b.splitDetails?.vendorCut || 0), 0)
          const tokenCollected = tokenPaidBookings.reduce((s, b) => s + (b.tokenAmount || 0), 0)

          return (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Total Revenue', value: `\u20b9${totalRevenue.toLocaleString('en-IN')}`, icon: 'account_balance', color: 'bg-green-50 text-green-600' },
                  { label: 'Platform Earnings', value: `\u20b9${platformEarnings.toLocaleString('en-IN')}`, icon: 'trending_up', color: 'bg-blue-50 text-blue-600' },
                  { label: 'Vendor Payouts', value: `\u20b9${vendorPayouts.toLocaleString('en-IN')}`, icon: 'payments', color: 'bg-purple-50 text-purple-600' },
                  { label: 'Tokens Collected', value: `\u20b9${tokenCollected.toLocaleString('en-IN')}`, icon: 'token', color: 'bg-orange-50 text-orange-600' },
                ].map(({ label, value, icon, color }) => (
                  <div key={label} className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-5">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${color}`}>
                      <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>{icon}</span>
                    </div>
                    <p className="text-label-md text-secondary">{label}</p>
                    <p className="text-2xl font-bold text-on-surface mt-1">{value}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-green-700">{paidBookings.length}</p>
                  <p className="text-label-md text-green-600 mt-1">Fully Paid</p>
                </div>
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-yellow-700">{tokenPaidBookings.length}</p>
                  <p className="text-label-md text-yellow-600 mt-1">Token Paid</p>
                </div>
                <div className="bg-surface-container border border-outline-variant rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-on-surface">{pendingBookings.length}</p>
                  <p className="text-label-md text-secondary mt-1">Payment Pending</p>
                </div>
              </div>

              <h3 className="font-bold text-lg">Recent Payments</h3>
              <div className="space-y-3">
                {allBookings
                  .filter(b => b.paymentStatus === 'paid' || b.paymentStatus === 'token_paid')
                  .slice(0, 20)
                  .map(b => (
                    <div key={b.id} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 flex items-center justify-between flex-wrap gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-bold text-on-surface text-label-md">{b.bookingId}</p>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            b.paymentStatus === 'paid' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {b.paymentStatus === 'paid' ? 'PAID' : 'TOKEN PAID'}
                          </span>
                        </div>
                        <p className="text-label-md text-secondary">{b.vehicleName} \u2022 {b.renterName}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-on-surface">\u20b9{(b.amountPaid || b.pricing?.total || 0).toLocaleString('en-IN')}</p>
                        {b.splitDetails && (
                          <p className="text-[10px] text-secondary">Platform: \u20b9{b.splitDetails.platformCut?.toLocaleString('en-IN')} | Vendor: \u20b9{b.splitDetails.vendorCut?.toLocaleString('en-IN')}</p>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )
        })()}
      </div>
    </PageLayout>
  )
}
