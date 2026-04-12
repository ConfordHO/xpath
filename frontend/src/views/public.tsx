import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import type { StaticImageData } from 'next/image'
import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded'
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import EmailRoundedIcon from '@mui/icons-material/EmailRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded'
import ScienceRoundedIcon from '@mui/icons-material/ScienceRounded'
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded'
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded'
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded'

import { useEffect, useState, type ReactNode } from 'react'

import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { api } from '../api'
import labMicroscope from '../assets/lab-microscope.jpg'
import labTeam from '../assets/lab-team.jpg'
import heroLab from '../assets/reference/hero-lab.jpg'
import serviceCytology from '../assets/reference/service-cytology.jpg'
import serviceHistology from '../assets/reference/service-histology.jpg'
import serviceReports from '../assets/reference/service-reports.jpg'

import { useAuth } from '../auth'

import {
  BrandLogo,
  LoadingPanel,
  PageHeader,
  SectionCard,
  StatusChip,
} from '../components'

import { errorMessage, PageError, useLoadable } from './shared'

import type {
  HydratedOrder,
  Patient,
  Payment,
  TestType,
} from '../types'

import { downloadPathologyReportPdf, formatDate, formatDateTime, formatMoney, paymentMethodLabel } from '../utils'

type AssetSource = string | StaticImageData

function assetSrc(src: AssetSource) {
  return typeof src === 'string' ? src : src.src
}

interface PublicConfig {
  accreditations: string[]
  aboutText: string
  businessHours: string
  contactAddress: string
  contactEmail: string
  contactPhone: string
  currency: string
  labName: string
  tagline: string
}

interface PatientPortalLookupSummary {
  _id: string
  createdAt: string
  orderNumber: string
  status: string
  testTypes: TestType[]
}

interface PatientPortalOrderDetail extends HydratedOrder {
  courierStatusLabel: string
  paidAmount: number
  patient: Patient
  payments: Payment[]
  testTypes: TestType[]
  timeline: Array<{ label: string; at: string; value?: string }>
  totalAmount: number
}

interface LocationSuggestion {
  display_name: string
  lat: string
  lon: string
  place_id: number
}

const patientPaymentMethods = [
  { value: 'mtn_mobile_money', label: 'MTN Mobile Money' },
  { value: 'orange_money', label: 'Orange Money' },
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'transfer', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
] as const

function isPaymentSuccessMessage(message: string) {
  return /submitted|completed|collection sent|approve/i.test(message)
}

function buildPatientPortalOrderLink(orderId: string, lastName: string, dateOfBirth: string) {
  const params = new URLSearchParams({
    lastName,
    dateOfBirth,
  })
  return `/patient-portal/order/${orderId}?${params.toString()}`
}

interface PublicExperienceLayoutProps {
  children: ReactNode
  contentMaxWidth?: number
  description: string
  eyebrow: string
  imageAlt: string
  imageSrc: AssetSource
  title: string
}

function LogoBadge() {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        px: { xs: 1.75, md: 2.25 },
        py: { xs: 1.25, md: 1.5 },
        borderRadius: 4,
        bgcolor: 'rgba(255,255,255,0.95)',
        boxShadow: '0 20px 60px rgba(7,17,38,0.18)',
      }}
    >
      <BrandLogo sx={{ width: { xs: 230, md: 320 } }} />
    </Box>
  )
}

function PublicExperienceLayout({
  children,
  contentMaxWidth = 720,
  description,
  eyebrow,
  imageAlt,
  imageSrc,
  title,
}: PublicExperienceLayoutProps) {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        background:
          'linear-gradient(160deg, rgba(8,25,55,0.96), rgba(21,101,192,0.9)), radial-gradient(circle at top right, rgba(255,255,255,0.16), transparent 30%)',
      }}
    >
      <Box
        sx={{
          maxWidth: 1340,
          mx: 'auto',
          px: { xs: 2, md: 4 },
          py: { xs: 2.5, md: 3.5 },
          display: 'grid',
          gap: { xs: 3, lg: 4 },
          gridTemplateColumns: { xs: '1fr', lg: '0.92fr 1.08fr' },
          alignItems: 'stretch',
          minHeight: '100vh',
        }}
      >
        <Stack
          justifyContent="space-between"
          spacing={3}
          sx={{ color: 'white', py: { xs: 1, lg: 2 } }}
        >
          <Stack spacing={3}>
            <Box sx={{ textAlign: { xs: 'center', lg: 'left' } }}>
              <LogoBadge />
            </Box>
            <Box>
              <Typography variant="overline" sx={{ letterSpacing: '0.14em', opacity: 0.74 }}>
                {eyebrow}
              </Typography>
              <Typography variant="h2" sx={{ mt: 2, maxWidth: 560 }}>
                {title}
              </Typography>
              <Typography sx={{ mt: 2, maxWidth: 560, color: 'rgba(255,255,255,0.82)' }}>
                {description}
              </Typography>
            </Box>
          </Stack>
          <Paper
            sx={{
              p: 1.25,
              overflow: 'hidden',
              borderRadius: 5,
              bgcolor: 'rgba(255,255,255,0.12)',
              borderColor: 'rgba(255,255,255,0.14)',
            }}
          >
            <Box
              component="img"
              src={assetSrc(imageSrc)}
              alt={imageAlt}
              sx={{
                width: '100%',
                height: { xs: 240, sm: 320, lg: 380 },
                objectFit: 'cover',
                borderRadius: 4,
                display: 'block',
              }}
            />
          </Paper>
        </Stack>
        <Stack justifyContent="center">
          <Paper sx={{ p: { xs: 3, md: 4 }, width: '100%', maxWidth: contentMaxWidth, ml: { lg: 'auto' } }}>
            {children}
          </Paper>
        </Stack>
      </Box>
    </Box>
  )
}

export function LandingPage() {
  const settingsState = useLoadable<PublicConfig | null>(null, [], async () => {
    const response = await api.get<PublicConfig>('/public/config')
    return response.data
  })
  const testTypesState = useLoadable<TestType[]>([], [], async () => {
    const response = await api.get<TestType[]>('/public/services')
    return response.data
  })

  if (settingsState.loading || testTypesState.loading) {
    return <LoadingPanel label="Loading public site…" />
  }
  if (settingsState.error || !settingsState.data) {
    return <PageError message={settingsState.error ?? 'Could not load settings'} />
  }
  const settings = settingsState.data

  const grouped = testTypesState.data.reduce<Record<string, TestType[]>>((acc, item) => {
    acc[item.category] ??= []
    acc[item.category].push(item)
    return acc
  }, {})

  const stats = [
    {
      icon: <PaymentsRoundedIcon sx={{ fontSize: 18 }} />,
      value: settings.currency,
      label: 'Pricing in local currency',
    },
    {
      icon: <AccessTimeRoundedIcon sx={{ fontSize: 18 }} />,
      value: '24–48 hrs',
      label: 'Typical turnaround',
    },
    {
      icon: <ShieldRoundedIcon sx={{ fontSize: 18 }} />,
      value: 'HIPAA-ready',
      label: 'Secure & compliant',
    },
  ]

  const serviceCards = [
    {
      icon: <ScienceRoundedIcon sx={{ fontSize: 18 }} />,
      image: serviceHistology,
      title: 'Histology & IHC',
      body: 'Histology, immunohistochemistry, and tissue processing with clear pricing and clinician-friendly turnaround.',
    },
    {
      icon: <VerifiedRoundedIcon sx={{ fontSize: 18 }} />,
      image: serviceCytology,
      title: 'Cytology & Molecular',
      body: 'Cytology and molecular testing with structured workflows, tracked samples, and dependable reporting.',
    },
    {
      icon: <DescriptionRoundedIcon sx={{ fontSize: 18 }} />,
      image: serviceReports,
      title: 'Reports & tracking',
      body: 'Secure result delivery, order tracking, downloadable reports, and a patient portal for follow-up.',
    },
  ]

  const highlightItems = [
    {
      icon: <ScienceRoundedIcon sx={{ fontSize: 18 }} />,
      label: 'Accredited pathology & histology processes',
    },
    {
      icon: <LockRoundedIcon sx={{ fontSize: 18 }} />,
      label: 'Secure, HIPAA-ready reporting & patient portals',
    },
    {
      icon: <SupportAgentRoundedIcon sx={{ fontSize: 18 }} />,
      label: 'Dedicated support for referring physicians and patients',
    },
  ]

  return (
    <Box sx={{ bgcolor: '#f7f7fb' }}>
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          color: 'white',
          background:
            'linear-gradient(112deg, rgba(0, 60, 143, 0.94) 0%, rgba(21, 101, 192, 0.88) 40%, rgba(0, 91, 79, 0.82) 100%)',
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `linear-gradient(90deg, rgba(0, 60, 143, 0.82) 0%, rgba(0, 60, 143, 0.56) 38%, rgba(0, 60, 143, 0.24) 100%), url(${assetSrc(heroLab)})`,
            backgroundSize: 'cover',
            backgroundPosition: { xs: 'center', md: 'center right' },
            opacity: 0.3,
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(80% 50% at 70% 50%, rgba(0, 137, 123, 0.18) 0%, rgba(0,0,0,0) 50%)',
          }}
        />
        <Box
          sx={{
            position: 'relative',
            maxWidth: 1280,
            mx: 'auto',
            px: { xs: 2, md: 4 },
            pt: { xs: 2, md: 2.5 },
            pb: { xs: 10, md: 11 },
          }}
        >
          <Stack
            direction={{ xs: 'column', lg: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', lg: 'center' }}
            spacing={2}
          >
            <Box
              sx={{
                display: 'inline-flex',
                px: 1.25,
                py: 0.75,
                bgcolor: 'rgba(255,255,255,0.96)',
                borderRadius: 3,
                boxShadow: '0 16px 44px rgba(5, 18, 45, 0.18)',
              }}
            >
              <BrandLogo sx={{ width: { xs: 130, md: 150 } }} />
            </Box>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={1}
              useFlexGap
              flexWrap="wrap"
              sx={{ width: { xs: '100%', lg: 'auto' } }}
            >
              {[
                ['Services', 'services'],
                ['Prices', 'prices'],
                ['About us', 'about'],
                ['Contact', 'contact'],
              ].map(([label, id]) => (
                <Button
                  key={id}
                  href={`#${id}`}
                  color="inherit"
                  sx={{
                    minWidth: 0,
                    px: 1.5,
                    py: 0.7,
                    borderRadius: 999,
                    fontSize: 12,
                    color: 'rgba(255,255,255,0.84)',
                  }}
                >
                  {label}
                </Button>
              ))}
              <Button
                component={RouterLink}
                to="/login"
                variant="outlined"
                color="inherit"
                sx={{
                  borderRadius: 999,
                  px: 1.75,
                  borderColor: 'rgba(255,255,255,0.28)',
                  color: 'rgba(255,255,255,0.92)',
                }}
              >
                Staff login
              </Button>
              <Button
                component={RouterLink}
                to="/order-online"
                variant="contained"
                sx={{
                  borderRadius: 999,
                  px: 1.85,
                  bgcolor: 'white',
                  color: 'primary.main',
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.92)' },
                }}
              >
                Request test online
              </Button>
              <Button
                component={RouterLink}
                to="/patient-portal"
                variant="outlined"
                color="inherit"
                sx={{
                  borderRadius: 999,
                  px: 1.75,
                  borderColor: 'rgba(255,255,255,0.28)',
                  color: 'rgba(255,255,255,0.92)',
                }}
              >
                Patient portal
              </Button>
            </Stack>
          </Stack>

          <Box sx={{ pt: { xs: 5.5, md: 7.5 }, pb: { xs: 1, md: 2 }, maxWidth: 610 }}>
            <Typography variant="overline" sx={{ letterSpacing: '0.18em', opacity: 0.78 }}>
              Pathology & Laboratory Services
            </Typography>
            <Typography
              variant="h1"
              sx={{
                mt: 1.75,
                maxWidth: 560,
                fontSize: { xs: 40, md: 58 },
                lineHeight: 0.96,
                textWrap: 'balance',
              }}
            >
              Reliable results. Clear pricing. Fast turnaround.
            </Typography>
            <Typography
              variant="h6"
              sx={{
                mt: 2.25,
                maxWidth: 560,
                color: 'rgba(255,255,255,0.82)',
                fontSize: { xs: 16, md: 18 },
                lineHeight: 1.7,
              }}
            >
              Browse pathology and lab services with transparent pricing. Request tests online,
              track results in the patient portal, and sign in as staff to manage orders and
              workflows.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 3.5 }}>
              <Button
                component={RouterLink}
                to="/login"
                variant="contained"
                sx={{
                  borderRadius: 999,
                  px: 2.5,
                  bgcolor: 'white',
                  color: 'primary.main',
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.92)' },
                }}
              >
                Staff login
              </Button>
              <Button
                component={RouterLink}
                to="/order-online"
                variant="contained"
                color="secondary"
                sx={{ borderRadius: 999, px: 2.5 }}
              >
                Request test online
              </Button>
              <Button
                component={RouterLink}
                to="/patient-portal"
                variant="outlined"
                color="inherit"
                sx={{
                  borderRadius: 999,
                  px: 2.5,
                  borderColor: 'rgba(255,255,255,0.34)',
                  color: 'rgba(255,255,255,0.94)',
                }}
              >
                Patient portal
              </Button>
            </Stack>
          </Box>
        </Box>
      </Box>

      <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 2, md: 4 }, mt: { xs: -4.5, md: -5.5 }, position: 'relative', zIndex: 2 }}>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
          {stats.map((item) => (
            <Paper
              key={item.label}
              sx={{
                p: 3,
                borderRadius: 4,
                textAlign: 'center',
                boxShadow: '0 20px 50px rgba(13, 35, 77, 0.08)',
              }}
            >
              <Box
                sx={{
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  mx: 'auto',
                  mb: 1.5,
                  display: 'grid',
                  placeItems: 'center',
                  color: 'primary.main',
                  bgcolor: 'rgba(21, 101, 192, 0.08)',
                }}
              >
                {item.icon}
              </Box>
              <Typography variant="h4" sx={{ fontSize: { xs: 28, md: 32 } }}>
                {item.value}
              </Typography>
              <Typography color="text.secondary" sx={{ mt: 0.9 }}>
                {item.label}
              </Typography>
            </Paper>
          ))}
        </Box>
      </Box>

      <Box id="services" sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 2, md: 4 }, pt: 8.5, pb: 5 }}>
        <Box sx={{ textAlign: 'center', maxWidth: 760, mx: 'auto' }}>
          <Typography variant="overline" sx={{ color: 'primary.main', letterSpacing: '0.2em' }}>
            What We Offer
          </Typography>
          <Typography variant="h3" sx={{ mt: 1.5 }}>
            Pathology & lab services
          </Typography>
          <Typography sx={{ mt: 1.5, color: 'text.secondary' }}>
            Histology, immunohistochemistry (IHC), cytology, and molecular testing with clear
            pricing and secure, timely reporting.
          </Typography>
        </Box>
        <Box sx={{ display: 'grid', gap: 2.5, mt: 4, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
          {serviceCards.map((card) => (
            <Paper
              key={card.title}
              sx={{
                overflow: 'hidden',
                borderRadius: 5,
                boxShadow: '0 22px 56px rgba(13, 35, 77, 0.08)',
              }}
            >
              <Box sx={{ position: 'relative', p: 1.2, pb: 0 }}>
                <Box
                  sx={{
                    position: 'absolute',
                    left: 22,
                    top: 22,
                    zIndex: 1,
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    color: 'primary.main',
                    bgcolor: 'rgba(255,255,255,0.94)',
                    boxShadow: '0 10px 24px rgba(13, 35, 77, 0.18)',
                  }}
                >
                  {card.icon}
                </Box>
                <Box
                  component="img"
                  src={assetSrc(card.image)}
                  alt={card.title}
                  sx={{
                    width: '100%',
                    height: 180,
                    objectFit: 'cover',
                    display: 'block',
                    borderRadius: 4,
                  }}
                />
              </Box>
              <Box sx={{ px: 2.25, pt: 2, pb: 2.5 }}>
                <Typography variant="h5" sx={{ fontSize: 24 }}>
                  {card.title}
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 1, lineHeight: 1.7 }}>
                  {card.body}
                </Typography>
              </Box>
            </Paper>
          ))}
        </Box>
      </Box>

      <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 2, md: 4 }, pb: 8 }}>
        <Paper
          sx={{
            px: { xs: 2, md: 3.5 },
            py: { xs: 2, md: 2.25 },
            borderRadius: 5,
            bgcolor: 'rgba(21, 101, 192, 0.06)',
            boxShadow: 'none',
          }}
        >
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
            {highlightItems.map((item) => (
              <Stack key={item.label} direction="row" spacing={1.25} alignItems="center">
                <Box
                  sx={{
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                    color: 'primary.main',
                    bgcolor: 'rgba(255,255,255,0.84)',
                  }}
                >
                  {item.icon}
                </Box>
                <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.7 }}>
                  {item.label}
                </Typography>
              </Stack>
            ))}
          </Box>
        </Paper>
      </Box>

      <Box sx={{ bgcolor: 'white', py: 8 }}>
        <Box id="prices" sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 2, md: 4 } }}>
          <Box sx={{ textAlign: 'center', maxWidth: 760, mx: 'auto', mb: 4 }}>
            <Typography variant="overline" sx={{ color: 'primary.main', letterSpacing: '0.2em' }}>
              Transparent Pricing
            </Typography>
            <Typography variant="h3" sx={{ mt: 1.5 }}>
              Prices
            </Typography>
            <Typography sx={{ mt: 1.5, color: 'text.secondary' }}>
              Current tests and prices. Contact the lab for package deals or bulk pricing.
            </Typography>
          </Box>
          <Stack spacing={2.5}>
            {Object.entries(grouped).map(([category, items]) => (
              <Paper
                key={category}
                sx={{
                  borderRadius: 4,
                  overflow: 'hidden',
                  boxShadow: '0 18px 48px rgba(13, 35, 77, 0.06)',
                }}
              >
                <Box sx={{ px: 2.5, py: 2 }}>
                  <Typography variant="h5">{category}</Typography>
                </Box>
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Code</TableCell>
                        <TableCell>Test / service</TableCell>
                        <TableCell align="right">Price ({settings.currency})</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {items.map((item) => (
                        <TableRow key={item._id}>
                          <TableCell>{item.code}</TableCell>
                          <TableCell>
                            <Typography fontWeight={600}>{item.name}</Typography>
                            {item.description ? (
                              <Typography variant="body2" color="text.secondary">
                                {item.description}
                              </Typography>
                            ) : null}
                          </TableCell>
                          <TableCell align="right">{formatMoney(item.price, settings.currency)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            ))}
          </Stack>
        </Box>
      </Box>

      <Box id="about" sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 2, md: 4 }, py: 8 }}>
        <Box sx={{ textAlign: 'center', maxWidth: 760, mx: 'auto' }}>
          <Typography variant="overline" sx={{ color: 'primary.main', letterSpacing: '0.2em' }}>
            Who We Are
          </Typography>
          <Typography variant="h3" sx={{ mt: 1.5 }}>
            About {settings.labName}
          </Typography>
          <Typography sx={{ mt: 1.5, color: 'text.secondary', lineHeight: 1.8 }}>
            {settings.aboutText}
          </Typography>
          <Stack direction="row" spacing={1.25} useFlexGap flexWrap="wrap" justifyContent="center" sx={{ mt: 3.5 }}>
            {settings.accreditations.map((item) => (
              <Paper key={item} sx={{ px: 2, py: 1.2, borderRadius: 999, boxShadow: 'none', bgcolor: 'rgba(21, 101, 192, 0.06)' }}>
                <Typography variant="subtitle2">{item}</Typography>
              </Paper>
            ))}
          </Stack>
        </Box>
      </Box>

      <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 2, md: 4 }, pb: 8 }}>
        <Paper
          sx={{
            textAlign: 'center',
            px: { xs: 2.5, md: 4 },
            py: { xs: 3.5, md: 4.25 },
            borderRadius: 5,
            bgcolor: 'rgba(21, 101, 192, 0.05)',
            boxShadow: '0 18px 48px rgba(13, 35, 77, 0.05)',
          }}
        >
          <Typography variant="h4">Ready to get started?</Typography>
          <Typography sx={{ mt: 1.25, color: 'text.secondary' }}>
            Staff: sign in to manage orders. Patients: use the patient portal to check your
            results securely.
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="center" sx={{ mt: 3 }}>
            <Button component={RouterLink} to="/login" variant="contained" sx={{ borderRadius: 999, px: 2.5 }}>
              Staff login
            </Button>
            <Button component={RouterLink} to="/patient-portal" variant="outlined" sx={{ borderRadius: 999, px: 2.5 }}>
              Patient portal
            </Button>
          </Stack>
        </Paper>
      </Box>

      <Box id="contact" sx={{ bgcolor: 'primary.main', color: 'white', py: 6 }}>
        <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 2, md: 4 }, textAlign: 'center' }}>
          <Box
            sx={{
              width: 42,
              height: 42,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              mx: 'auto',
              mb: 2,
              bgcolor: 'rgba(255,255,255,0.12)',
            }}
          >
            <EmailRoundedIcon sx={{ fontSize: 20 }} />
          </Box>
          <Typography variant="h5">Contact {settings.labName}</Typography>
          <Typography sx={{ mt: 1.25, color: 'rgba(255,255,255,0.82)' }}>
            For test inquiries, pricing, referring clinician support, or patient results, use the
            details below or the patient portal.
          </Typography>
          <Typography sx={{ mt: 2.5, color: 'rgba(255,255,255,0.88)' }}>
            {settings.contactEmail} | {settings.contactPhone}
          </Typography>
          <Typography sx={{ mt: 0.75, color: 'rgba(255,255,255,0.72)' }}>
            {settings.contactAddress} | {settings.businessHours}
          </Typography>
          <Box
            sx={{
              mt: 3,
              display: 'inline-flex',
              px: 1.25,
              py: 0.75,
              bgcolor: 'rgba(255,255,255,0.96)',
              borderRadius: 3,
            }}
          >
            <BrandLogo sx={{ width: { xs: 150, md: 170 } }} />
          </Box>
          <Typography sx={{ mt: 2.5, color: 'rgba(255,255,255,0.6)' }}>
            © {settings.labName} — Pathology Lab Information Management System
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}

export function LoginPage() {
  const { signIn, user } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('admin@xpath.lims')
  const [password, setPassword] = useState('admin123')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (user) {
      navigate('/dashboard', { replace: true })
    }
  }, [navigate, user])

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await signIn(email, password)
      navigate('/dashboard')
    } catch (submitError) {
      setError(errorMessage(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        px: 2,
        display: 'grid',
        placeItems: 'center',
        bgcolor: '#1565c0',
        background: 'linear-gradient(180deg, #1565c0 0%, #155bb0 100%)',
      }}
    >
      <Paper
        sx={{
          width: '100%',
          maxWidth: 460,
          p: { xs: 3, md: 4 },
          borderRadius: 4,
          boxShadow: '0 22px 64px rgba(8, 25, 55, 0.22)',
        }}
      >
        <Stack spacing={2.5}>
          <BrandLogo sx={{ width: 220 }} />
          <Typography color="text.secondary">Laboratory Information Management System</Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField label="Email" value={email} onChange={(event) => setEmail(event.target.value)} fullWidth />
          <TextField label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} fullWidth />
          <Button disabled={submitting} variant="contained" onClick={submit} fullWidth>
            Sign in
          </Button>
          <Typography color="text.secondary" sx={{ textAlign: 'center' }}>
            Use your seeded staff credentials to access the correct role dashboard.
          </Typography>
          <Button component={RouterLink} to="/patient-portal" variant="text">
            Patient? Look up your test results
          </Button>
        </Stack>
      </Paper>
    </Box>
  )
}

export function OrderOnlinePage() {
  const testTypesState = useLoadable<TestType[]>([], [], async () => {
    const response = await api.get<TestType[]>('/public/services')
    return response.data
  })
  const [patient, setPatient] = useState({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    gender: 'male',
    phone: '',
    email: '',
    address: '',
  })
  const [pickupAddress, setPickupAddress] = useState('')
  const [pickupSearch, setPickupSearch] = useState('')
  const [pickupSuggestions, setPickupSuggestions] = useState<LocationSuggestion[]>([])
  const [pickupPlaceName, setPickupPlaceName] = useState('')
  const [pickupLat, setPickupLat] = useState<number | null>(null)
  const [pickupLng, setPickupLng] = useState<number | null>(null)
  const [searchingPickup, setSearchingPickup] = useState(false)
  const [pickupSearchError, setPickupSearchError] = useState<string | null>(null)
  const [testTypeIds, setTestTypeIds] = useState<string[]>([])
  const [referringDoctor, setReferringDoctor] = useState('')
  const [clinicalHistory, setClinicalHistory] = useState('')
  const [notes, setNotes] = useState('')
  const [submitted, setSubmitted] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const lookupPickupLocation = async () => {
    if (pickupSearch.trim().length < 3) {
      setPickupSearchError('Enter at least 3 characters to search for a pickup location.')
      return
    }

    setSearchingPickup(true)
    setPickupSearchError(null)
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(
          pickupSearch.trim(),
        )}`,
      )
      if (!response.ok) {
        throw new Error('Location search is unavailable right now.')
      }
      const data = (await response.json()) as LocationSuggestion[]
      setPickupSuggestions(data)
      if (!data.length) {
        setPickupSearchError('No matching pickup locations were found. You can still type the address manually below.')
      }
    } catch (searchError) {
      setPickupSearchError(errorMessage(searchError))
    } finally {
      setSearchingPickup(false)
    }
  }

  const submit = async () => {
    setError(null)
    setSubmitted(null)
    try {
      const response = await api.post<{ orderNumber: string }>('/public/order-request', {
        ...patient,
        pickupAddress: pickupAddress || patient.address,
        pickupPlaceName: pickupPlaceName || undefined,
        pickupLat: pickupLat ?? undefined,
        pickupLng: pickupLng ?? undefined,
        testTypes: testTypeIds,
        referringDoctor,
        notes,
        clinicalHistory,
      })
      setSubmitted(response.data.orderNumber)
      setPatient({
        firstName: '',
        lastName: '',
        dateOfBirth: '',
        gender: 'male',
        phone: '',
        email: '',
        address: '',
      })
      setPickupAddress('')
      setPickupSearch('')
      setPickupSuggestions([])
      setPickupPlaceName('')
      setPickupLat(null)
      setPickupLng(null)
      setTestTypeIds([])
      setReferringDoctor('')
      setClinicalHistory('')
      setNotes('')
    } catch (submitError) {
      setError(errorMessage(submitError))
    }
  }

  return (
    <PublicExperienceLayout
      eyebrow="Online Intake"
      title="Request a pathology test online"
      description="Submit demographics, choose tests, and send a pickup address. Our courier workflow will take it from there."
      imageAlt="Digital pathology microscope"
      imageSrc={labMicroscope}
      contentMaxWidth={860}
    >
      <Stack spacing={2}>
        <Typography variant="h4">Request test online</Typography>
        <Typography color="text.secondary">
          At least one test is required. Save the generated order number after submission so you can track the case in the patient portal.
        </Typography>
        {submitted ? (
          <Alert severity="success">
            Order created successfully. Your order number is <strong>{submitted}</strong>. Use it together with your last name and date of birth in the patient portal to track pickup, processing, billing, and final results.
          </Alert>
        ) : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' } }}>
          <TextField label="First name" value={patient.firstName} onChange={(event) => setPatient((prev) => ({ ...prev, firstName: event.target.value }))} />
          <TextField label="Last name" value={patient.lastName} onChange={(event) => setPatient((prev) => ({ ...prev, lastName: event.target.value }))} />
          <TextField label="Date of birth" type="date" InputLabelProps={{ shrink: true }} value={patient.dateOfBirth} onChange={(event) => setPatient((prev) => ({ ...prev, dateOfBirth: event.target.value }))} />
          <FormControl fullWidth>
            <InputLabel>Gender</InputLabel>
            <Select label="Gender" value={patient.gender} onChange={(event) => setPatient((prev) => ({ ...prev, gender: String(event.target.value) }))}>
              <MenuItem value="male">Male</MenuItem>
              <MenuItem value="female">Female</MenuItem>
              <MenuItem value="other">Other</MenuItem>
            </Select>
          </FormControl>
          <TextField label="Phone" value={patient.phone} onChange={(event) => setPatient((prev) => ({ ...prev, phone: event.target.value }))} />
          <TextField label="Email" value={patient.email} onChange={(event) => setPatient((prev) => ({ ...prev, email: event.target.value }))} />
        </Box>
        <TextField label="Patient address" value={patient.address} onChange={(event) => setPatient((prev) => ({ ...prev, address: event.target.value }))} />
        <SectionCard title="Pickup location">
          <Stack spacing={2}>
            <Typography color="text.secondary">
              Search for the pickup location as done in the reference system, or type the address manually if needed.
            </Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField
                label="Search pickup location"
                value={pickupSearch}
                onChange={(event) => setPickupSearch(event.target.value)}
                fullWidth
              />
              <Button variant="outlined" disabled={searchingPickup} onClick={lookupPickupLocation}>
                Find location
              </Button>
            </Stack>
            {pickupSearchError ? <Alert severity="info">{pickupSearchError}</Alert> : null}
            {pickupSuggestions.length ? (
              <Stack spacing={1.5}>
                {pickupSuggestions.map((suggestion) => (
                  <Paper
                    key={suggestion.place_id}
                    sx={{ p: 2, cursor: 'pointer' }}
                    onClick={() => {
                      setPickupAddress(suggestion.display_name)
                      setPickupPlaceName(suggestion.display_name)
                      setPickupLat(Number(suggestion.lat))
                      setPickupLng(Number(suggestion.lon))
                      setPickupSuggestions([])
                      setPickupSearch(suggestion.display_name)
                    }}
                  >
                    <Typography fontWeight={600}>{suggestion.display_name}</Typography>
                    <Typography color="text.secondary" variant="body2">
                      Lat {Number(suggestion.lat).toFixed(5)}, Lng {Number(suggestion.lon).toFixed(5)}
                    </Typography>
                  </Paper>
                ))}
              </Stack>
            ) : null}
            <TextField
              label="Pickup address"
              value={pickupAddress}
              onChange={(event) => setPickupAddress(event.target.value)}
              fullWidth
            />
            <TextField
              label="Pickup place name"
              value={pickupPlaceName}
              onChange={(event) => setPickupPlaceName(event.target.value)}
              fullWidth
            />
          </Stack>
        </SectionCard>
        <Typography variant="subtitle2">Select tests</Typography>
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' } }}>
          {testTypesState.data.map((test) => (
            <Paper key={test._id} sx={{ p: 2 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={testTypeIds.includes(test._id)}
                    onChange={(event) => {
                      setTestTypeIds((prev) =>
                        event.target.checked ? [...prev, test._id] : prev.filter((item) => item !== test._id),
                      )
                    }}
                  />
                }
                label={`${test.code} — ${test.name} (${formatMoney(test.price)})`}
              />
            </Paper>
          ))}
        </Box>
        <TextField label="Referring clinician" value={referringDoctor} onChange={(event) => setReferringDoctor(event.target.value)} />
        <TextField label="Clinical history" multiline minRows={3} value={clinicalHistory} onChange={(event) => setClinicalHistory(event.target.value)} />
        <TextField label="Notes" multiline minRows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Button variant="contained" disabled={!testTypeIds.length} onClick={submit}>
            Submit order request
          </Button>
          <Button component={RouterLink} to="/patient-portal" variant="outlined">
            Log in to Patient portal to track order
          </Button>
        </Stack>
      </Stack>
    </PublicExperienceLayout>
  )
}

export function PatientPortalPage() {
  const navigate = useNavigate()
  const [orderNumber, setOrderNumber] = useState('')
  const [lastName, setLastName] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [results, setResults] = useState<PatientPortalLookupSummary[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lookup = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get<HydratedOrder | { data: PatientPortalLookupSummary[] }>('/patient-portal/lookup', {
        params: {
          orderNumber: orderNumber || undefined,
          lastName,
          dateOfBirth,
        },
      })
      if ('data' in response.data) {
        setResults(response.data.data)
      } else {
        navigate(buildPatientPortalOrderLink(response.data._id, lastName, dateOfBirth))
      }
    } catch (lookupError) {
      setError(errorMessage(lookupError))
    } finally {
      setLoading(false)
    }
  }

  return (
    <PublicExperienceLayout
      eyebrow="Patient Portal"
      title="Find your pathology orders"
      description="Use your last name and date of birth to see current and past orders, payment status, courier progress, and final results."
      imageAlt="Pathology laboratory workspace"
      imageSrc={labTeam}
      contentMaxWidth={860}
    >
      <Stack spacing={3}>
        <Box>
          <Typography variant="h4">Find your orders</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            Use the saved order number together with your last name and date of birth for the fastest lookup. If you do not have the order number yet, we can still search matching orders.
          </Typography>
        </Box>
        <SectionCard>
          <Stack spacing={2}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
              <TextField label="Order number" value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} />
              <TextField label="Last name" value={lastName} onChange={(event) => setLastName(event.target.value)} />
              <TextField label="Date of birth" type="date" InputLabelProps={{ shrink: true }} value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} />
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Button variant="contained" disabled={loading} onClick={lookup}>
                Find my orders
              </Button>
              <Button component={RouterLink} to="/login" variant="text">
                Staff? Sign in to LIMS
              </Button>
            </Stack>
          </Stack>
        </SectionCard>

        {results ? (
          <Box>
            <PageHeader title="Your orders" description="All your tests with XPath Lab. Click an order for details, timeline, results, and payment." />
            <Stack spacing={2}>
              {results.map((order) => (
                <Paper
                  key={order._id}
                  component={RouterLink}
                  to={buildPatientPortalOrderLink(order._id, lastName, dateOfBirth)}
                  sx={{ p: 3, display: 'block' }}
                >
                  <Typography variant="h5">{order.orderNumber}</Typography>
                  <Typography color="text.secondary" sx={{ mt: 1 }}>
                    {formatDate(order.createdAt)} · {order.status}
                  </Typography>
                  <Typography sx={{ mt: 1 }}>{order.testTypes.map((item) => item.code).join(', ')}</Typography>
                </Paper>
              ))}
            </Stack>
            <Button sx={{ mt: 2 }} onClick={() => setResults(null)}>
              Look up different person
            </Button>
          </Box>
        ) : null}
      </Stack>
    </PublicExperienceLayout>
  )
}

export function PatientOrderDetailPage() {
  const { orderId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [lastName, setLastName] = useState(searchParams.get('lastName') ?? '')
  const [dateOfBirth, setDateOfBirth] = useState(searchParams.get('dateOfBirth') ?? '')
  const [detail, setDetail] = useState<PatientPortalOrderDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requestingPayment, setRequestingPayment] = useState(false)
  const [paymentFeedback, setPaymentFeedback] = useState<string | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] =
    useState<(typeof patientPaymentMethods)[number]['value']>('mtn_mobile_money')
  const [paymentReference, setPaymentReference] = useState('')

  const loadDetail = async (identityLastName = lastName, identityDateOfBirth = dateOfBirth) => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get<PatientPortalOrderDetail>(`/patient-portal/order/${orderId}`, {
        params: {
          lastName: identityLastName,
          dateOfBirth: identityDateOfBirth,
        },
      })
      setDetail(response.data)
      const outstanding = Math.max(response.data.totalAmount - response.data.paidAmount, 0)
      setPaymentAmount(outstanding > 0 ? String(outstanding) : '')
      const params = new URLSearchParams({
        lastName: identityLastName,
        dateOfBirth: identityDateOfBirth,
      })
      setSearchParams(params, { replace: true })
    } catch (detailError) {
      setDetail(null)
      setError(errorMessage(detailError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (lastName && dateOfBirth) {
      void loadDetail(lastName, dateOfBirth)
    }
  }, [orderId])

  const submitVerification = async () => {
    setPaymentFeedback(null)
    await loadDetail(lastName, dateOfBirth)
  }

  const submitPaymentRequest = async () => {
    if (!detail) {
      return
    }
    setRequestingPayment(true)
    setPaymentFeedback(null)
    try {
      const response = await api.post<{ message?: string }>(
        `/patient-portal/order/${detail._id}/payment-request`,
        {
          amount: Number(paymentAmount),
          method: paymentMethod,
          reference: paymentReference || undefined,
        },
        {
          params: {
            lastName,
            dateOfBirth,
          },
        },
      )
      setPaymentFeedback(
        response.data.message
          ?? 'Payment request submitted. The finance team can now reconcile it against your order.',
      )
      setPaymentReference('')
      await loadDetail(lastName, dateOfBirth)
    } catch (paymentError) {
      setPaymentFeedback(errorMessage(paymentError))
    } finally {
      setRequestingPayment(false)
    }
  }

  if (!lastName || !dateOfBirth) {
    return (
      <PublicExperienceLayout
        eyebrow="Patient Portal"
        title="Verify your identity"
        description="Enter the same last name and date of birth used on the order before viewing the result, payment, and courier details."
        imageAlt="Microscope slide for pathology analysis"
        imageSrc={labMicroscope}
        contentMaxWidth={620}
      >
        <Stack spacing={2.5}>
          <Typography variant="h4">Verify to continue</Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField label="Last name" value={lastName} onChange={(event) => setLastName(event.target.value)} />
          <TextField label="Date of birth" type="date" InputLabelProps={{ shrink: true }} value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Button variant="contained" onClick={submitVerification}>
              Continue
            </Button>
            <Button component={RouterLink} to="/patient-portal">
              Back to patient portal
            </Button>
          </Stack>
        </Stack>
      </PublicExperienceLayout>
    )
  }

  if (loading) return <LoadingPanel label="Loading order details…" />
  if (error || !detail) {
    return (
      <PublicExperienceLayout
        eyebrow="Patient Portal"
        title="Order details and tracking"
        description="Verify your details to view the order, billing, courier updates, and final report."
        imageAlt="Microscope slide for pathology analysis"
        imageSrc={labMicroscope}
        contentMaxWidth={620}
      >
        <Stack spacing={2.5}>
          <Typography variant="h4">We could not verify this order</Typography>
          <Alert severity="error">{error ?? 'Order not found'}</Alert>
          <TextField label="Last name" value={lastName} onChange={(event) => setLastName(event.target.value)} />
          <TextField label="Date of birth" type="date" InputLabelProps={{ shrink: true }} value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Button variant="contained" onClick={submitVerification}>
              Try again
            </Button>
            <Button component={RouterLink} to="/patient-portal">
              Back to patient portal
            </Button>
          </Stack>
        </Stack>
      </PublicExperienceLayout>
    )
  }

  const outstandingBalance = Math.max(detail.totalAmount - detail.paidAmount, 0)

  return (
    <PublicExperienceLayout
      eyebrow="Patient Portal"
      title="Order details and tracking"
      description="Follow each step from intake through reporting, including courier movement and payment progress."
      imageAlt="Microscope slide for pathology analysis"
      imageSrc={labMicroscope}
      contentMaxWidth={920}
    >
      <Stack spacing={3}>
        <PageHeader
          title={detail.orderNumber}
          action={<Button component={RouterLink} to="/patient-portal">Back to my orders</Button>}
        />
        <SectionCard>
          <Stack spacing={2}>
            <StatusChip status={detail.status} />
            <Typography variant="h6">Patient</Typography>
            <Typography>{detail.patient.firstName} {detail.patient.lastName}</Typography>
            <Typography color="text.secondary">Date of birth: {formatDate(detail.patient.dateOfBirth)}</Typography>
            <Typography variant="h6">Order source</Typography>
            <Typography>Source: {detail.orderSource.replace('_', ' ')}</Typography>
            <Typography>Referred by: {detail.referringDoctor ?? '—'}</Typography>
            <Typography variant="h6">Tests requested</Typography>
            {detail.testTypes.map((test) => (
              <Typography key={test._id}>{test.code} — {test.name}</Typography>
            ))}
            <Typography variant="h6">Identifiers</Typography>
            <Typography>Order number: {detail.orderNumber}</Typography>
            <Typography>Pickup location: {detail.pickupPlaceName ?? detail.pickupAddress ?? detail.patient.address ?? '—'}</Typography>
            <Typography>Lab received: {formatDateTime(detail.receivedAt ?? detail.courierReceivedAt)}</Typography>
            <Typography>Report completed: {formatDateTime(detail.completedAt)}</Typography>
            <Typography>Result released: {formatDateTime(detail.releasedAt)}</Typography>
            <Typography variant="h6">Timeline</Typography>
            {detail.timeline.map((item) => (
              <Paper key={`${item.label}-${item.at}`} sx={{ p: 2 }}>
                <Typography fontWeight={600}>{item.label}</Typography>
                <Typography color="text.secondary">{formatDateTime(item.at)}</Typography>
                {item.value ? <Typography sx={{ mt: 0.5 }}>{item.value}</Typography> : null}
              </Paper>
            ))}
            <Typography variant="h6">Courier status</Typography>
            <Typography>{detail.courierStatusLabel}</Typography>
            <Typography variant="h6">Payment</Typography>
            <Typography>Order total: {formatMoney(detail.totalAmount)}</Typography>
            <Typography>Paid: {formatMoney(detail.paidAmount)}</Typography>
            <Typography>Outstanding: {formatMoney(outstandingBalance)}</Typography>
            {detail.payments.map((payment) => (
              <Paper key={payment._id} sx={{ p: 2 }}>
                <Typography fontWeight={600}>
                  {formatMoney(payment.amount)} — {paymentMethodLabel(payment.method)}
                </Typography>
                <Typography color="text.secondary">
                  {formatDateTime(payment.createdAt)} · {payment.status}
                </Typography>
                {payment.providerStatus || payment.gatewayReference ? (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {payment.providerStatus ? `Gateway ${payment.providerStatus}` : 'Reference available'}
                    {payment.gatewayReference ? ` · Ref ${payment.gatewayReference}` : ''}
                  </Typography>
                ) : null}
              </Paper>
            ))}
          </Stack>
        </SectionCard>

        <SectionCard title="Results">
          <Stack spacing={2}>
            <Typography variant="h6">Pathologist summary</Typography>
            <Typography color="text.secondary">
              {detail.reportSummary ?? 'The report is not yet finalized. Once the case is signed out and released, the result summary will appear here.'}
            </Typography>
            <Typography variant="h6">Diagnosis</Typography>
            <Typography color="text.secondary">
              {detail.pathologistDiagnosis ?? 'Diagnosis pending final review.'}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Button
                startIcon={<DownloadRoundedIcon />}
                disabled={!detail.reportSummary && !detail.pathologistDiagnosis}
                onClick={() => {
                  void downloadPathologyReportPdf(`report-${detail.orderNumber}.pdf`, detail)
                }}
              >
                Download report PDF
              </Button>
              <Button component={RouterLink} to="/patient-portal">
                Track another order
              </Button>
            </Stack>
          </Stack>
        </SectionCard>

        {outstandingBalance > 0 ? (
          <SectionCard title="Request payment confirmation">
            <Stack spacing={2}>
              <Typography color="text.secondary">
                Submit a payment request from the patient portal so the finance desk can reconcile it and clear the order when appropriate.
              </Typography>
              {paymentFeedback ? <Alert severity={isPaymentSuccessMessage(paymentFeedback) ? 'success' : 'error'}>{paymentFeedback}</Alert> : null}
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
                <TextField
                  label="Amount"
                  type="number"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                />
                <FormControl fullWidth>
                  <InputLabel>Payment method</InputLabel>
                  <Select
                    label="Payment method"
                    value={paymentMethod}
                    onChange={(event) =>
                      setPaymentMethod(event.target.value as (typeof patientPaymentMethods)[number]['value'])
                    }
                  >
                    {patientPaymentMethods.map((method) => (
                      <MenuItem key={method.value} value={method.value}>
                        {method.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  label="Reference"
                  value={paymentReference}
                  onChange={(event) => setPaymentReference(event.target.value)}
                />
              </Box>
              <Button variant="contained" disabled={requestingPayment || Number(paymentAmount) <= 0} onClick={submitPaymentRequest}>
                Submit payment request
              </Button>
            </Stack>
          </SectionCard>
        ) : (
          <Alert severity="success">This order has no outstanding patient balance.</Alert>
        )}
        
        <SectionCard title="Support">
          <Stack spacing={1}>
            <Typography color="text.secondary">
              If your sample was collected online, the courier updates move from scheduled pickup to in-transit and then received at lab.
            </Typography>
            <Typography color="text.secondary">
              If the report is still pending, the case may be awaiting grossing, staining, pathologist review, or release after financial and clinical checks.
            </Typography>
          </Stack>
        </SectionCard>
      </Stack>
    </PublicExperienceLayout>
  )
}
