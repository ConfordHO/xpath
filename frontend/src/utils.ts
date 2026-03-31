import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'

import { storageKeys } from './api'
import logoLarge from './assets/logo_large.png'

import type { CourierStatus, HydratedOrder, OrderStatus, Payment, Report } from './types'

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

type ReportLocale = 'en' | 'fr'

interface ReportTimelineEntry {
  label: string
  at: string
  value?: string
}

interface ReportAccessionLike {
  accessionId?: string
  blocks?: Array<{
    blockId: string
    slides?: Array<{
      slideId: string
      imageUrls?: string[]
    }>
  }>
}

export interface PathologyReportDetail extends HydratedOrder {
  report?: Report | null
  timeline?: ReportTimelineEntry[]
  accession?: ReportAccessionLike | null
}

interface PathologyReportOptions {
  locale?: ReportLocale
}

const reportBrand = {
  labName: 'X.PATH LABS',
  tagline: 'CENTER FOR MOLECULAR PATHOLOGY AND GENOMICS',
  city: 'Yaounde, Cameroon',
  phone: '+237-691193779 / +237-677804723',
  email: 'info@xpath-labs.com',
  address: 'Rue 6460 Mbankolo (Petit Paris), BP: 35444, Yaounde - Cameroon',
}

const reportCopy = {
  en: {
    confidential: 'PRIVATE AND CONFIDENTIAL PATHOLOGY RESULTS',
    histologyTitle: 'HISTOLOGY REPORT (FINAL)',
    summaryTitle: 'SUMMARY DATASET',
    slidesTitle: 'SLIDES / IMAGES',
    finalTitle: 'FINAL HISTOLOGY RESULT',
    patientPanel: 'Patient details',
    patient: 'Patient',
    born: 'Born',
    age: 'aged',
    contact: 'Contact',
    physician: 'Attention',
    address: 'Address',
    yourRef: 'Your #',
    labRef: 'Lab #',
    status: 'Status',
    final: 'Final',
    collected: 'Collected',
    received: "Spec. Recv'd",
    printed: 'Printed',
    clinical: 'CLINICAL INFORMATION',
    gross: 'GROSS DESCRIPTION',
    microscopy: 'MICROSCOPY',
    diagnosis: 'DIAGNOSIS',
    tests: 'TESTS ORDERED',
    orderDetails: 'ORDER DETAILS',
    timeline: 'WORKFLOW TIMELINE',
    summary: 'SUMMARY DATASET',
    signout: 'SIGN-OUT',
    authenticity:
      'This result was electronically generated by X.PATH Labs. Scan the QR code or open the validation link to confirm authenticity.',
    validationLink: 'Validation link',
    generatedBy: 'END OF REPORT • Generated by X.PATH LABS',
    pending: 'Pending final sign-out.',
    none: 'None',
    draftNote: 'DRAFT COPY. NOT FOR FINAL CLINICAL USE.',
    page: 'Page',
  },
  fr: {
    confidential: 'RESULTATS DE PATHOLOGIE PRIVES ET CONFIDENTIELS',
    histologyTitle: 'RAPPORT HISTOLOGIQUE (FINAL)',
    summaryTitle: 'JEU DE DONNEES RESUME',
    slidesTitle: 'LAMES / IMAGES',
    finalTitle: 'RESULTAT HISTOLOGIQUE FINAL',
    patientPanel: 'Details du patient',
    patient: 'Patient',
    born: 'Ne(e) le',
    age: 'age de',
    contact: 'Contact',
    physician: "A l'attention de",
    address: 'Adresse',
    yourRef: 'Votre #',
    labRef: 'Lab #',
    status: 'Statut',
    final: 'Final',
    collected: 'Preleve',
    received: 'Recu au labo',
    printed: 'Imprime',
    clinical: 'INFORMATIONS CLINIQUES',
    gross: 'DESCRIPTION MACROSCOPIQUE',
    microscopy: 'MICROSCOPIE',
    diagnosis: 'DIAGNOSTIC',
    tests: 'ANALYSES DEMANDEES',
    orderDetails: 'DETAILS DE LA DEMANDE',
    timeline: 'CHRONOLOGIE DU WORKFLOW',
    summary: 'RESUME',
    signout: 'VALIDATION',
    authenticity:
      "Ce resultat a ete genere electroniquement par X.PATH Labs. Scannez le QR code ou ouvrez le lien de validation pour verifier son authenticite.",
    validationLink: 'Lien de validation',
    generatedBy: 'FIN DU RAPPORT • Genere par X.PATH LABS',
    pending: 'En attente de validation finale.',
    none: 'Aucun',
    draftNote: 'COPIE BROUILLON. NON UTILISABLE POUR UNE DECISION CLINIQUE FINALE.',
    page: 'Page',
  },
} as const

function currentReportLocale(explicitLocale?: ReportLocale) {
  if (explicitLocale) {
    return explicitLocale
  }
  const locale = typeof window !== 'undefined' ? window.localStorage.getItem(storageKeys.locale) : 'fr'
  return locale === 'en' ? 'en' : 'fr'
}

function reportDate(value?: string | null, locale: ReportLocale = currentReportLocale()) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString(locale === 'en' ? 'en-US' : 'fr-CM')
}

function reportDateTime(value?: string | null, locale: ReportLocale = currentReportLocale()) {
  if (!value) return '—'
  return new Date(value).toLocaleString(locale === 'en' ? 'en-US' : 'fr-CM')
}

function patientGenderLabel(gender?: string | null, locale: ReportLocale = currentReportLocale()) {
  if (gender === 'female') return locale === 'en' ? 'F' : 'F'
  if (gender === 'male') return locale === 'en' ? 'M' : 'M'
  return locale === 'en' ? 'U' : 'I'
}

function patientAgeLabel(dateOfBirth?: string | null, locale: ReportLocale = currentReportLocale()) {
  if (!dateOfBirth) return '—'
  const dob = new Date(dateOfBirth)
  if (Number.isNaN(dob.getTime())) return '—'
  const nowDate = new Date()
  let years = nowDate.getFullYear() - dob.getFullYear()
  let months = nowDate.getMonth() - dob.getMonth()
  if (months < 0 || (months === 0 && nowDate.getDate() < dob.getDate())) {
    years -= 1
    months += 12
  }
  if (years > 0) {
    return locale === 'en' ? `${years} year${years === 1 ? '' : 's'}` : `${years} an${years === 1 ? '' : 's'}`
  }
  return locale === 'en' ? `${Math.max(months, 0)} month${months === 1 ? '' : 's'}` : `${Math.max(months, 0)} mois`
}

function buildAuthenticityUrl(orderNumber: string) {
  if (typeof window === 'undefined') {
    return ''
  }
  const url = new URL('/order-authenticity', window.location.origin)
  url.searchParams.set('orderNumber', orderNumber)
  return url.toString()
}

async function buildAuthenticityQr(orderNumber: string) {
  const authenticityUrl = buildAuthenticityUrl(orderNumber)
  if (!authenticityUrl) {
    return { authenticityUrl, qrSrc: '' }
  }
  const qrSrc = await QRCode.toDataURL(authenticityUrl, {
    width: 148,
    margin: 1,
    color: {
      dark: '#0f274d',
      light: '#ffffff',
    },
  })
  return { authenticityUrl, qrSrc }
}

function splitToLines(pdf: jsPDF, text: string, width: number, maxLines: number) {
  const lines = pdf.splitTextToSize(text || '—', width) as string[]
  if (lines.length <= maxLines) {
    return lines
  }
  const trimmed = lines.slice(0, maxLines)
  const last = trimmed[maxLines - 1] ?? ''
  trimmed[maxLines - 1] = last.length > 2 ? `${last.slice(0, Math.max(0, last.length - 1))}…` : '…'
  return trimmed
}

function drawTextBlock(
  pdf: jsPDF,
  label: string,
  body: string,
  x: number,
  y: number,
  width: number,
  maxLines: number,
) {
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(10.5)
  pdf.setTextColor(18, 57, 103)
  pdf.text(label, x, y)
  const lines = splitToLines(pdf, body || '—', width, maxLines)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.setTextColor(22, 29, 37)
  pdf.text(lines, x, y + 5)
  return y + 5 + lines.length * 4.5 + 3
}

function drawReportChrome(
  pdf: jsPDF,
  detail: PathologyReportDetail,
  report: Report | null,
  locale: ReportLocale,
  pageNumber: number,
  totalPages: number,
  logoImage: HTMLImageElement | null,
) {
  const copy = reportCopy[locale]
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()

  pdf.setFillColor(255, 255, 255)
  pdf.rect(0, 0, pageWidth, pageHeight, 'F')

  pdf.setFillColor(15, 39, 77)
  pdf.rect(0, 0, pageWidth, 13, 'F')
  pdf.setTextColor(255, 255, 255)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.text(reportBrand.labName, pageWidth - 14, 8.2, { align: 'right' })

  try {
    if (!logoImage) {
      throw new Error('Missing logo image')
    }
    // A slightly taller lockup keeps the result document close to the reference style.
    pdf.addImage(logoImage, 'PNG', 14, 16, 70, 16)
  } catch {
    pdf.setTextColor(15, 39, 77)
    pdf.setFontSize(20)
    pdf.text(reportBrand.labName, 14, 27)
  }

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.setTextColor(15, 39, 77)
  pdf.text(reportBrand.city, pageWidth - 14, 21, { align: 'right' })
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8.8)
  pdf.text(reportBrand.phone, pageWidth - 14, 25.8, { align: 'right' })
  pdf.text(reportBrand.email, pageWidth - 14, 30.4, { align: 'right' })

  pdf.setFillColor(102, 180, 224)
  pdf.rect(14, 36, pageWidth - 28, 7, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.setTextColor(255, 255, 255)
  pdf.text(copy.confidential, pageWidth / 2, 40.8, { align: 'center' })

  pdf.setDrawColor(209, 213, 219)
  pdf.setFillColor(241, 245, 249)
  pdf.roundedRect(pageWidth - 74, 49, 60, 26, 1.6, 1.6, 'FD')
  pdf.setTextColor(17, 24, 39)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9.6)
  pdf.text(copy.patientPanel, pageWidth - 70, 55)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8.6)
  pdf.text(`${detail.patient.firstName} ${detail.patient.lastName}`, pageWidth - 70, 60.2)
  pdf.text(
    `${copy.born} ${reportDate(detail.patient.dateOfBirth, locale)} ${copy.age} ${patientAgeLabel(detail.patient.dateOfBirth, locale)} / ${patientGenderLabel(detail.patient.gender, locale)}`,
    pageWidth - 70,
    64.8,
  )
  pdf.text(`${copy.contact}: ${detail.patient.phone || '—'}`, pageWidth - 70, 69.4)

  pdf.setTextColor(18, 57, 103)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9.4)
  pdf.text(`${copy.yourRef}: ${detail.priority === 'urgent' ? '[-URGENT-]' : '—'}`, 14, 52.5)
  pdf.text(`${copy.labRef}: ${detail.orderNumber} (${report?.status === 'complete' ? copy.final : detail.status})`, 14, 57.1)
  pdf.text(`${copy.physician}: ${detail.referringDoctor ?? '—'}`, 14, 61.7)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8.6)
  const addressLines = splitToLines(pdf, detail.patient.address || reportBrand.address, 98, 2)
  pdf.text(addressLines, 14, 66.4)
  pdf.text(
    `${copy.collected}: ${reportDateTime(detail.createdAt, locale)}    ${copy.received}: ${reportDateTime(detail.receivedAt, locale)}    ${copy.printed}: ${reportDateTime(detail.releasedAt ?? report?.updatedAt ?? detail.updatedAt, locale)}`,
    14,
    77.6,
  )

  pdf.setFillColor(102, 180, 224)
  pdf.rect(14, 84, pageWidth - 28, 7, 'F')
  pdf.setTextColor(255, 255, 255)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11.5)
  pdf.text(copy.histologyTitle, pageWidth / 2, 88.8, { align: 'center' })

  const footerText = `${copy.page} ${pageNumber} / ${totalPages}`
  const identifierText = `Results #${detail.orderNumber} ${detail.patient.lastName}/${reportDate(detail.createdAt, locale)}`
  pdf.setTextColor(148, 163, 184)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(7.2)
  const invalidLine = 'INVALID IF ALTERED!    INVALID IF ALTERED!    INVALID IF ALTERED!'
  pdf.text(invalidLine, 14, 279)
  pdf.text(invalidLine, 14, 283.2)
  pdf.setTextColor(71, 85, 105)
  pdf.setFont('helvetica', 'normal')
  pdf.text(identifierText, 14, 288)
  pdf.text(footerText, pageWidth - 14, 288, { align: 'right' })
}

export async function downloadPathologyReportPdf(
  filename: string,
  detail: PathologyReportDetail,
  options: PathologyReportOptions = {},
) {
  const locale = currentReportLocale(options.locale)
  const copy = reportCopy[locale]
  const report = detail.report ?? null
  const pdf = new jsPDF({ format: 'a4', unit: 'mm' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const allSlides = detail.accession?.blocks?.flatMap((block) => block.slides?.map((slide) => slide.slideId) ?? []) ?? []
  const testsText = detail.testTypes.map((item) => `${item.code} — ${item.name}`).join(', ') || '—'
  const timelineText = (detail.timeline ?? [])
    .slice(0, 6)
    .map((entry) => `${entry.label}: ${reportDateTime(entry.at, locale)}`)
    .join('\n') || copy.none
  const { authenticityUrl, qrSrc } = await buildAuthenticityQr(detail.orderNumber)
  let logoImage: HTMLImageElement | null = null
  try {
    logoImage = await loadImage(logoLarge)
  } catch {
    logoImage = null
  }

  drawReportChrome(pdf, detail, report, locale, 1, 3, logoImage)

  let y = 99
  y = drawTextBlock(pdf, copy.clinical, detail.clinicalHistory || detail.notes || copy.pending, 14, y, 182, 4)
  y = drawTextBlock(pdf, copy.gross, report?.grossDescription || copy.pending, 14, y, 182, 4)
  y = drawTextBlock(pdf, copy.microscopy, report?.microscopicDescription || copy.pending, 14, y, 182, 6)
  drawTextBlock(pdf, copy.diagnosis, report?.diagnosis || report?.comment || copy.pending, 14, y, 182, 6)

  pdf.addPage()
  drawReportChrome(pdf, detail, report, locale, 2, 3, logoImage)
  y = 99
  y = drawTextBlock(pdf, copy.summaryTitle, report?.comment || copy.pending, 14, y, 182, 5)
  y = drawTextBlock(pdf, copy.tests, testsText, 14, y, 182, 4)
  y = drawTextBlock(
    pdf,
    copy.orderDetails,
    [
      `${copy.status}: ${statusLabel(detail.status)}`,
      `${copy.labRef}: ${detail.orderNumber}`,
      `${copy.collected}: ${reportDateTime(detail.createdAt, locale)}`,
      `${copy.received}: ${reportDateTime(detail.receivedAt, locale)}`,
      `Accession: ${detail.accession?.accessionId ?? '—'}`,
      `Financial clearance: ${detail.financialClearance ?? 'pending'}`,
    ].join('\n'),
    14,
    y,
    182,
    7,
  )
  drawTextBlock(pdf, copy.timeline, timelineText, 14, y, 182, 7)

  pdf.addPage()
  drawReportChrome(pdf, detail, report, locale, 3, 3, logoImage)
  y = 99
  y = drawTextBlock(pdf, copy.slidesTitle, allSlides.length ? allSlides.join(', ') : copy.none, 14, y, 182, 4)
  y = drawTextBlock(
    pdf,
    copy.finalTitle,
    report?.diagnosis || report?.comment || copy.pending,
    14,
    y,
    182,
    5,
  )
  y = drawTextBlock(
    pdf,
    copy.signout,
    [
      `${copy.status}: ${report?.status ?? 'draft'}`,
      `Signed by: ${report?.signedBy ?? '—'}`,
      `Signed at: ${reportDateTime(report?.signedAt, locale)}`,
      `Released: ${reportDateTime(detail.releasedAt ?? report?.emailedAt, locale)}`,
    ].join('\n'),
    14,
    y,
    110,
    5,
  )

  if (report?.status !== 'complete') {
    pdf.setTextColor(179, 38, 30)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10)
    pdf.text(copy.draftNote, 14, y + 3)
  }

  if (qrSrc) {
    const qrImage = await loadImage(qrSrc)
    pdf.addImage(qrImage, 'PNG', pageWidth - 56, 212, 36, 36)
  }

  pdf.setTextColor(31, 41, 55)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9.4)
  const authenticityLines = splitToLines(pdf, copy.authenticity, 110, 4)
  pdf.text(authenticityLines, 14, 225)
  pdf.setFont('helvetica', 'bold')
  pdf.text(copy.validationLink, 14, 247)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(18, 57, 103)
  pdf.text(splitToLines(pdf, authenticityUrl || '—', 110, 2), 14, 252)

  pdf.setTextColor(71, 85, 105)
  pdf.setFont('helvetica', 'bold')
  pdf.text(copy.generatedBy, pageWidth / 2, 271, { align: 'center' })
  pdf.save(filename)
}
