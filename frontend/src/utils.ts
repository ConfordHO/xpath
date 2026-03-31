import { jsPDF } from 'jspdf'

import { storageKeys } from './api'
import logoLarge from './assets/logo_large.png'

import type { CourierStatus, OrderStatus, Payment } from './types'

interface PdfMetadataRow {
  label: string
  value: string
}

interface PdfSection {
  heading?: string
  lines: string[]
}

interface DownloadPdfOptions {
  footer?: string
  metadata?: PdfMetadataRow[]
  note?: string
  sections?: PdfSection[]
}

export function formatDate(value?: string | null) {
  if (!value) return '—'
  const locale = typeof window !== 'undefined' ? window.localStorage.getItem(storageKeys.locale) : 'fr'
  return new Date(value).toLocaleDateString(locale === 'en' ? 'en-US' : 'fr-CM')
}

export function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const locale = typeof window !== 'undefined' ? window.localStorage.getItem(storageKeys.locale) : 'fr'
  return new Date(value).toLocaleString(locale === 'en' ? 'en-US' : 'fr-CM')
}

export function formatMoney(amount: number, currency = 'XAF') {
  const locale = typeof window !== 'undefined' ? window.localStorage.getItem(storageKeys.locale) : 'fr'
  const resolvedLocale =
    currency === 'XAF' || locale === 'fr'
      ? 'fr-CM'
      : 'en-US'
  return new Intl.NumberFormat(resolvedLocale, {
    style: 'currency',
    currency,
  }).format(amount)
}

export function paymentMethodLabel(method: Payment['method']) {
  switch (method) {
    case 'cash':
      return 'Cash'
    case 'card':
      return 'Card'
    case 'mobile_money':
      return 'Mobile money'
    case 'mtn_mobile_money':
      return 'MTN Mobile Money'
    case 'orange_money':
      return 'Orange Money'
    case 'bank_transfer':
    case 'transfer':
      return 'Bank transfer'
    default:
      return 'Other'
  }
}

export function statusLabel(status: OrderStatus) {
  return status.replace(/_/g, ' ')
}

export function courierStatusLabel(status: CourierStatus) {
  const labels: Record<CourierStatus, string> = {
    '': 'Not started',
    ready_for_pickup: 'Scheduled for pickup',
    on_way_to_pickup: 'Courier on the way to pick up',
    at_site_for_pickup: 'Courier at your location',
    picked_up_on_way_to_lab: 'Sample picked up, on the way to lab',
    in_transit: 'In transit to lab',
    received_at_lab: 'Received at lab',
  }
  return labels[status]
}

async function loadImage(src: string) {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Could not load image: ${src}`))
    image.src = src
  })
}

function drawMetadataRow(pdf: jsPDF, rows: PdfMetadataRow[], startY: number) {
  if (!rows.length) {
    return startY
  }

  let y = startY
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10.5)
  pdf.setTextColor(58, 65, 78)

  for (const row of rows) {
    const text = `${row.label}: ${row.value || '—'}`
    const wrapped = pdf.splitTextToSize(text, 182)
    pdf.text(wrapped, 14, y)
    y += wrapped.length * 5 + 1.5
  }

  return y + 2
}

export async function downloadPdfDocument(
  filename: string,
  title: string,
  lines: string[],
  options: DownloadPdfOptions = {},
) {
  const pdf = new jsPDF({ format: 'a4', unit: 'mm' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const sections = options.sections ?? [{ lines }]

  try {
    const logo = await loadImage(logoLarge)
    pdf.addImage(logo, 'PNG', 14, 11, 58, 15)
  } catch {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(16)
    pdf.setTextColor(21, 101, 192)
    pdf.text('X.PATH LABS', 14, 20)
  }

  pdf.setDrawColor(21, 101, 192)
  pdf.setLineWidth(0.4)
  pdf.line(14, 30, pageWidth - 14, 30)

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(20)
  pdf.setTextColor(31, 41, 55)
  pdf.text(title, pageWidth - 14, 20, { align: 'right' })

  let y = 40
  if (options.note) {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10)
    pdf.setTextColor(179, 38, 30)
    pdf.text(options.note, 14, y)
    y += 8
  }

  y = drawMetadataRow(pdf, options.metadata ?? [], y)
  pdf.setTextColor(31, 41, 55)

  for (const section of sections) {
    if (section.heading) {
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(11.5)
      pdf.text(section.heading, 14, y)
      y += 6
    }

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(10.5)
    for (const line of section.lines) {
      const wrapped = pdf.splitTextToSize(line || '—', 182)
      pdf.text(wrapped, 14, y)
      y += wrapped.length * 5 + 2
    }
    y += 2
  }

  const footer = options.footer ?? 'X.PATH LABS • Center for Molecular Pathology and Genomics'
  pdf.setFontSize(9)
  pdf.setTextColor(107, 114, 128)
  pdf.text(footer, 14, 287)
  pdf.save(filename)
}
