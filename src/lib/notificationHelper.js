import { auth } from './firebase'
import { apiFetch } from './api'

/**
 * Create a notification for a user. Routes through the backend so it also
 * delivers an FCM push. Notifications are intentionally created only by the
 * trusted backend so callers cannot forge notifications for arbitrary users.
 */
export const sendNotification = async ({ userId, type, title, body, actionUrl = '', bookingId }) => {
  if (!userId) return
  try {
    const token = await auth.currentUser?.getIdToken()
    if (!token) return
    await apiFetch('/api/notifications/send', {
      token,
      method: 'POST',
      body: JSON.stringify({ userId, type, title, body, actionUrl, bookingId }),
    })
  } catch (err) {
    console.error('sendNotification failed:', err)
  }
}
