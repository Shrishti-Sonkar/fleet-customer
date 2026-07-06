// Cloudinary uploads.
// Files are uploaded directly from the browser using an *unsigned* upload
// preset — no backend or secret keys required. Configure these in .env:
//   VITE_CLOUDINARY_CLOUD_NAME     your Cloudinary cloud name
//   VITE_CLOUDINARY_UPLOAD_PRESET  name of an unsigned upload preset
const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

/**
 * Upload a File/Blob to Cloudinary and return its secure (https) URL.
 * @param {File|Blob} file   The file or blob to upload.
 * @param {string} [folder]  Optional Cloudinary folder to organize uploads.
 * @returns {Promise<string>} The uploaded asset's secure_url.
 */
export async function uploadFile(file, folder) {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    throw new Error(
      'Cloudinary is not configured. Set VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET.',
    )
  }

  const form = new FormData()
  form.append('file', file)
  form.append('upload_preset', UPLOAD_PRESET)
  if (folder) form.append('folder', folder)

  // `auto` resource type handles images and PDFs alike.
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`,
    { method: 'POST', body: form },
  )

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.error?.message || `Upload failed (${res.status})`)
  }
  return data.secure_url
}
