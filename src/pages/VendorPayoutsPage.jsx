import { useEffect, useState } from 'react'
import { doc, getDoc, updateDoc, collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import PageLayout from '../components/layout/PageLayout'
import toast from 'react-hot-toast'

export default function VendorPayoutsPage() {
  const { user } = useAuth()
  const [razorpayAccountId, setRazorpayAccountId] = useState('')
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [ifsc, setIfsc] = useState('')
  const [saving, setSaving] = useState(false)
  const [payouts, setPayouts] = useState([])

  useEffect(() => {
    if (!user) return
    // Load existing payout settings
    getDoc(doc(db, 'users', user.uid)).then(snap => {
      if (snap.exists()) {
        const data = snap.data()
        setRazorpayAccountId(data.razorpayAccountId || '')
        setBankName(data.payout?.bankName || '')
        setAccountNumber(data.payout?.accountNumber || '')
        setIfsc(data.payout?.ifsc || '')
      }
    })
    // Load payout history
    const q = query(
      collection(db, 'bookings'),
      where('ownerId', '==', user.uid),
      where('paymentStatus', '==', 'paid')
    )
    return onSnapshot(q, (snap) => {
      setPayouts(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(b => b.splitDetails))
    })
  }, [user])

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        razorpayAccountId: razorpayAccountId.trim(),
        payout: { bankName, accountNumber, ifsc, status: 'active' },
      })
      toast.success('Payout details saved!')
    } catch (err) {
      toast.error('Failed to save: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const totalSettled = payouts.filter(p => p.splitDetails?.transferStatus === 'processed').reduce((s, p) => s + (p.splitDetails?.vendorCut || 0), 0)

  return (
    <PageLayout>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">Payout Setup</h1>

        {/* Payout Account Form */}
        <form onSubmit={handleSave} className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 space-y-5 mb-8">
          <h2 className="font-bold text-lg">Razorpay & Bank Details</h2>
          <p className="text-label-md text-secondary">Enter your Razorpay linked account ID for automatic payouts. Your bank details are for record-keeping.</p>
          
          <div>
            <label className="block text-label-md font-bold text-on-surface-variant mb-2">Razorpay Linked Account ID</label>
            <input
              value={razorpayAccountId}
              onChange={e => setRazorpayAccountId(e.target.value)}
              placeholder="acc_XXXXXXXXXX"
              className="w-full h-11 px-4 rounded-xl border border-outline-variant focus:border-primary outline-none transition-all"
            />
            <p className="text-xs text-secondary mt-1">Get this from your Razorpay Dashboard under Route → Linked Accounts</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-label-md font-bold text-on-surface-variant mb-2">Bank Name</label>
              <input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="e.g. HDFC Bank" className="w-full h-11 px-4 rounded-xl border border-outline-variant focus:border-primary outline-none transition-all" />
            </div>
            <div>
              <label className="block text-label-md font-bold text-on-surface-variant mb-2">Account Number</label>
              <input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="XXXXXXXXXXXX" className="w-full h-11 px-4 rounded-xl border border-outline-variant focus:border-primary outline-none transition-all" />
            </div>
            <div>
              <label className="block text-label-md font-bold text-on-surface-variant mb-2">IFSC Code</label>
              <input value={ifsc} onChange={e => setIfsc(e.target.value)} placeholder="HDFC0001234" className="w-full h-11 px-4 rounded-xl border border-outline-variant focus:border-primary outline-none transition-all" />
            </div>
          </div>

          <button disabled={saving} className="h-11 px-6 rounded-xl bg-primary-container text-white font-bold hover:opacity-90 disabled:opacity-50 transition-all">
            {saving ? 'Saving...' : 'Save Payout Details'}
          </button>
        </form>

        {/* Payout History */}
        <h2 className="text-lg font-bold mb-4">Payout History</h2>
        <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-5 mb-4">
          <p className="text-label-md text-secondary">Total Settled</p>
          <p className="text-2xl font-bold text-green-600">₹{totalSettled.toLocaleString('en-IN')}</p>
        </div>
        
        {payouts.length === 0 ? (
          <div className="text-center py-12 bg-surface-container-lowest border border-outline-variant rounded-2xl">
            <span className="material-symbols-outlined text-5xl text-secondary mb-3 block">receipt_long</span>
            <p className="text-secondary">No payouts yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {payouts.map(p => (
              <div key={p.id} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="font-bold text-on-surface">{p.vehicleName}</p>
                  <p className="text-label-md text-secondary">{p.bookingId} • {p.pickupDate}</p>
                  {p.splitDetails?.transferId && <p className="text-xs text-secondary font-mono">Transfer: {p.splitDetails.transferId}</p>}
                </div>
                <div className="text-right">
                  <p className="font-bold text-green-600">₹{(p.splitDetails?.vendorCut || 0).toLocaleString('en-IN')}</p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    p.splitDetails?.transferStatus === 'processed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {p.splitDetails?.transferStatus === 'processed' ? 'SETTLED' : 'PENDING'}
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
