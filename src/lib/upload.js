// Cloudinary uploads use a short-lived backend signature. No upload preset or
// API secret is exposed in the browser bundle.
import { auth } from './firebase'
import { apiFetch } from './api'

/**
 * Upload a File/Blob to Cloudinary and return its secure URL.
 * @param {File|Blob} file File or Blob to upload.
 * @param {string} folder Folder beginning with kyc, vehicles, or profilePhotos.
 * @returns {Promise<string>} The uploaded asset's secure URL.
 */
export async function uploadFile(file, folder) {
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error('You must be signed in to upload a file.')

  const purpose = String(folder || '').split('/')[0]
  const signed = await apiFetch('/api/uploads/sign', {
    token,
    method: 'POST',
    body: JSON.stringify({ purpose }),
  })

  const form = new FormData()
  form.append('file', file)
  form.append('api_key', signed.apiKey)
  form.append('timestamp', String(signed.timestamp))
  form.append('signature', signed.signature)
  form.append('folder', signed.folder)
  form.append('allowed_formats', signed.allowedFormats)

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${signed.cloudName}/auto/upload`,
    { method: 'POST', body: form },
  )

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.error?.message || `Upload failed (${res.status})`)
  }
  return data.secure_url
}
