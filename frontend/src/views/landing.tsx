import {
  Box,
  Button,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import MuiLink from '@mui/material/Link'
import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded'
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded'
import EmailRoundedIcon from '@mui/icons-material/EmailRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import MedicalInformationRoundedIcon from '@mui/icons-material/MedicalInformationRounded'
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded'
import ScienceRoundedIcon from '@mui/icons-material/ScienceRounded'
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded'
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded'
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded'
import { Link as RouterLink } from 'react-router-dom'

import { api } from '../api'
import { BrandLogo } from '../components'
import type { TestType } from '../types'
import { formatInsurancePrice, formatTestPrice } from '../utils'
import { useLoadable } from './shared'

const heroLab = '/landing-hero.webp'
const serviceCytology = '/service-cytology.webp'
const serviceHistology = '/service-histology.webp'
const serviceReports = '/service-reports.webp'

function assetSrc(src: string) {
  return src
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

const fallbackConfig: PublicConfig = {
  accreditations: ['Molecular pathology', 'Genomics', 'Quality-controlled reporting'],
  aboutText:
    'OLYVIA is a Lab Information Management System (LIMS) developed by X.PATH Labs, a center for molecular pathology and genomics in Yaounde, Cameroon, in partnership with Buntu Labs Technologies, a software and systems development firm based in Nairobi, Kenya. OLYVIA supports pathology consultation, histology, cytology, immunohistochemistry, molecular testing, quality-controlled report release, and coordinated result delivery for laboratories in Africa and worldwide.',
  businessHours: 'Mon-Fri 7:30-17:30; Sat 8:00-13:00',
  contactAddress: 'Yaounde, Cameroon',
  contactEmail: 'info@xpath-labs.com',
  contactPhone: '+237 699 000 000',
  currency: 'XAF',
  labName: 'OLYVIA LIMS',
  tagline: 'Reliable results. Clear pricing. Fast turnaround.',
}

const fallbackServices: TestType[] = [
  {
    _id: 'landing-histology',
    active: true,
    category: 'Histology',
    code: 'HIST',
    createdAt: '',
    description: 'Tissue processing, embedding, sectioning, staining, and pathology review.',
    name: 'Histology consultation',
    price: 35000,
    insurancePrice: 45000,
    sampleType: 'Tissue',
    updatedAt: '',
  },
  {
    _id: 'landing-ihc',
    active: true,
    category: 'Immunohistochemistry',
    code: 'IHC',
    createdAt: '',
    description: 'IHC panel support for diagnostic confirmation and tumor characterization.',
    name: 'IHC marker panel',
    price: 50000,
    insurancePrice: 65000,
    sampleType: 'FFPE block',
    updatedAt: '',
  },
  {
    _id: 'landing-molecular',
    active: true,
    category: 'Molecular pathology',
    code: 'MOL',
    createdAt: '',
    description: 'Molecular pathology and genomics workflows with structured reporting.',
    name: 'Molecular diagnostic test',
    price: 75000,
    insurancePrice: 90000,
    sampleType: 'Tissue / blood',
    updatedAt: '',
  },
]

function LinkedAboutText({ text }: { text: string }) {
  const partnerName = 'Buntu Labs Technologies'
  const segments = text.split(partnerName)

  if (segments.length === 1) {
    return <>{text}</>
  }

  return (
    <>
      {segments.map((segment, index) => (
        <span key={`${segment}-${index}`}>
          {segment}
          {index < segments.length - 1 ? (
            <MuiLink
              href="https://www.buntulabs.com"
              target="_blank"
              rel="noopener noreferrer"
              underline="hover"
              sx={{ fontWeight: 700 }}
            >
              {partnerName}
            </MuiLink>
          ) : null}
        </span>
      ))}
    </>
  )
}

export function LandingPage() {
  const settingsState = useLoadable<PublicConfig>(fallbackConfig, [], async () => {
    const response = await api.get<PublicConfig>('/public/config')
    return response.data
  })
  const testTypesState = useLoadable<TestType[]>(fallbackServices, [], async () => {
    const response = await api.get<TestType[]>('/public/services')
    return response.data.length ? response.data : fallbackServices
  })

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
      value: '24-48 hrs',
      label: 'Typical turnaround',
    },
    {
      icon: <ShieldRoundedIcon sx={{ fontSize: 18 }} />,
      value: 'QC-ready',
      label: 'Secure & controlled',
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
      label: 'Pathology, histology, cytology, molecular pathology, and genomics workflows',
    },
    {
      icon: <LockRoundedIcon sx={{ fontSize: 18 }} />,
      label: 'Secure, quality-controlled reporting and patient portals',
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
          component="img"
          src={assetSrc(heroLab)}
          alt=""
          loading="eager"
          decoding="async"
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: { xs: 'center', md: 'center right' },
            opacity: 0.24,
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(90deg, rgba(0, 60, 143, 0.82) 0%, rgba(0, 60, 143, 0.56) 38%, rgba(0, 60, 143, 0.24) 100%)',
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
              <Button
                component={RouterLink}
                to="/doctor-portal"
                variant="outlined"
                color="inherit"
                startIcon={<MedicalInformationRoundedIcon />}
                sx={{
                  borderRadius: 999,
                  px: 1.75,
                  borderColor: 'rgba(255,255,255,0.28)',
                  color: 'rgba(255,255,255,0.92)',
                }}
              >
                Clinician portal
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
              {settings.tagline || fallbackConfig.tagline}
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
              <Button
                component={RouterLink}
                to="/doctor-portal"
                variant="outlined"
                color="inherit"
                startIcon={<MedicalInformationRoundedIcon />}
                sx={{
                  borderRadius: 999,
                  px: 2.5,
                  borderColor: 'rgba(255,255,255,0.34)',
                  color: 'rgba(255,255,255,0.94)',
                }}
              >
                Clinician portal
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
                  loading="lazy"
                  decoding="async"
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
                        <TableCell>Sample</TableCell>
                        <TableCell align="right">Patient price</TableCell>
                        <TableCell align="right">Insurer price</TableCell>
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
                          <TableCell>{item.sampleType ?? '-'}</TableCell>
                          <TableCell align="right">{formatTestPrice(item)}</TableCell>
                          <TableCell align="right">{formatInsurancePrice(item)}</TableCell>
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
            About OLYVIA, X.PATH Labs & Buntu Labs
          </Typography>
          <Typography sx={{ mt: 1.5, color: 'text.secondary', lineHeight: 1.8 }}>
            <LinkedAboutText text={settings.aboutText} />
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
            Staff: sign in to manage orders. Patients and referring clinicians can use their
            secure portals to track cases and released reports.
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="center" sx={{ mt: 3 }}>
            <Button component={RouterLink} to="/login" variant="contained" sx={{ borderRadius: 999, px: 2.5 }}>
              Staff login
            </Button>
            <Button component={RouterLink} to="/patient-portal" variant="outlined" sx={{ borderRadius: 999, px: 2.5 }}>
              Patient portal
            </Button>
            <Button component={RouterLink} to="/doctor-portal" variant="outlined" startIcon={<MedicalInformationRoundedIcon />} sx={{ borderRadius: 999, px: 2.5 }}>
              Clinician portal
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
          <Typography variant="h5">Contact X.PATH Labs</Typography>
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
            © X.PATH Labs - Powered by OLYVIA LIMS
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}
