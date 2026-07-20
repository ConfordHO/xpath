import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  InputBase,
  Link,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import QRCode from 'qrcode'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'

import { api } from '../api'
import { BrandLogo, LoadingPanel } from '../components'
import { OcrOrderUpload } from '../components/OcrOrderUpload'
import type { TestType } from '../types'
import { formatDateTime } from '../utils'

import { errorMessage, PageError, useLoadable } from './shared'

type FormLanguage = 'en' | 'fr'

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

interface OrderFormSession {
  reservationId: string
  orderNumber: string
  language: FormLanguage
  expiresAt: string
  verificationToken: string
}

interface OrderAuthenticityResponse {
  valid: boolean
  status: 'submitted' | 'reserved' | 'not_found'
  orderNumber: string
  createdAt?: string
  updatedAt?: string
  expiresAt?: string
  labName?: string
  message: string
}

interface RequisitionSpecimenRowState {
  source: string
  clinicalImpression: string
}

interface RequisitionFormState {
  patient: {
    firstName: string
    lastName: string
    dateOfBirth: string
    gender: 'male' | 'female' | 'other'
    phone: string
    email: string
    address: string
    ethnicity: string
  }
  physicianSignatureName: string
  placeDate: string
  requisitionCompletedBy: string
  requisitionCompletedByPhone: string
  referringPhysicianName: string
  referringPhysicianAddress: string
  referringPhysicianCity: string
  referringPhysicianRegion: string
  referringPhysicianPhone: string
  referringPhysicianEmail: string
  sendResultsToPhysician: boolean
  sendResultsToPatient: boolean
  referringFacilityName: string
  referringFacilityAddress: string
  billingMode: 'insurance_employer' | 'self_pay' | 'guarantor'
  insuranceName: string
  insuranceNumber: string
  policyHolder: string
  insuranceContactPhone: string
  guarantorName: string
  guarantorPhone: string
  collectionDate: string
  collectionTime: string
  diagnosis: string
  preOperativeDiagnosis: string
  postOperativeDiagnosis: string
  medicalHistory: string
  clinicalHistory: string
  additionalRequests: string
  specimenType: string
  formalinAddedTime: string
  otherTestsRequested: string
  testTypeIds: string[]
  specimenFlags: {
    fluid: boolean
    biopsyMultiple: boolean
    surgicalResection: boolean
    gynPap: boolean
    boneMarrow: boolean
    boneMarrowAspirate: boolean
    blood: boolean
    slides: boolean
    cassetteParaffinBlock: boolean
  }
  specimenRows: RequisitionSpecimenRowState[]
}

const regularTestIds = [
  'test-cy-f-001',
  'test-cy-f-002',
  'test-he-b-002',
  'test-he-bm-003',
  'test-he-bm-001',
  'test-hi-t-001',
  'test-hi-t-002',
  'test-hi-t-003',
  'test-hi-t-004',
  'test-hs-t-005',
  'test-im-t-01',
  'test-im-t-02',
  'test-im-t-03',
  'test-im-t-04',
  'test-im-t-05',
  'test-im-t-06',
  'test-bt-b-001',
  'test-co-t-01',
  'test-co-t-02',
  'test-co-n-03',
  'test-mo-b-001',
  'test-mo-t-002',
  'test-mo-t-003',
  'test-mo-b-004',
  'test-mo-b-05',
  'test-mo-s-06',
] as const

const packageTestIds = [
  'test-pk-t-001',
  'test-pk-bm-002',
] as const

const solidTumorPanels = [
  {
    panel: 'Breast Cancer Panel',
    antibodies: 'ER, PR, HER2, Ki-67, p120, E-Cadherin, GATA-3',
    utility: 'Determines eligibility for endocrine and targeted therapies.',
  },
  {
    panel: 'Cervix / HPV Panel',
    antibodies: 'p16, p40 / p63',
    utility: 'Identifies HPV-related high-grade lesions.',
  },
  {
    panel: 'Prostate Cancer Panel',
    antibodies: 'PSA',
    utility: 'Confirms prostatic origin in metastatic disease.',
  },
  {
    panel: 'Colorectal Cancer Panel',
    antibodies: 'CK20, CDX2, BRAF, MMR panel',
    utility: 'Supports Lynch syndrome screening and lineage confirmation.',
  },
  {
    panel: 'Gastric Cancer Panel',
    antibodies: 'HER2, CK7, CK20, PD-L1, MMR',
    utility: 'Therapeutic stratification for trastuzumab and immunotherapy.',
  },
  {
    panel: 'Lung Cancer Panel',
    antibodies: 'TTF-1, Napsin A, p40 / p63, +/- ALK',
    utility: 'Subtyping of non-small cell lung cancer.',
  },
  {
    panel: 'Endometrial Cancer Panel',
    antibodies: 'ER, PR, p53, MMR panel',
    utility: 'Differentiates type I and type II cancers.',
  },
  {
    panel: 'Liver Tumor Panel',
    antibodies: 'Glypican-3, Arginase-1',
    utility: 'Confirms hepatocellular carcinoma.',
  },
  {
    panel: 'Sarcoma Panel',
    antibodies: 'Pan-CK, Desmin, SMA, CD31, CD34, SOX10, Ki-67',
    utility: 'Confirms mesenchymal origin and subtyping.',
  },
  {
    panel: 'Unknown Primary Panel',
    antibodies: 'Pan-CK, CK7, CK20, CDX2, GATA-3, TTF-1',
    utility: 'Maps the site of tumor origin.',
  },
]

const hematopathologyPanels = [
  {
    panel: 'Basic Lymphoma Panel',
    antibodies: 'CD45, CD20, CD3, Ki-67',
    utility: 'First-line distinction between B-cell and T-cell lineages.',
  },
  {
    panel: 'Hodgkin Lymphoma Panel',
    antibodies: 'CD30, PAX5, CD15, CD20, CD3',
    utility: 'Distinguishes classical Hodgkin lymphoma from other types.',
  },
  {
    panel: 'Burkitt Lymphoma Panel',
    antibodies: 'CD20, CD10, BCL6, Ki-67',
    utility: 'Diagnostic support for Burkitt lymphoma.',
  },
  {
    panel: 'DLBCL Panel',
    antibodies: 'CD20, CD10, BCL6, BCL2, Ki-67',
    utility: 'Hans-algorithm prognostic classification.',
  },
  {
    panel: 'Multiple Myeloma Panel',
    antibodies: 'CD138, CD38, Kappa, Lambda',
    utility: 'Confirms plasma-cell phenotype and clonal restriction.',
  },
]

const tumorMarkerRows = [
  {
    cancer: 'Breast',
    markers: 'CA 15-3 + CEA',
    utility: 'Detects metastasis and recurrence.',
  },
  {
    cancer: 'Prostate',
    markers: 'PSA',
    utility: 'Evaluates treatment success.',
  },
  {
    cancer: 'Liver',
    markers: 'AFP',
    utility: 'Indicates whether treatment is working.',
  },
  {
    cancer: 'Colorectal',
    markers: 'CEA',
    utility: 'Monitors post-operative recurrence.',
  },
]

const copy = {
  en: {
    chooseLanguage: 'Choose your requisition language',
    chooseLanguageBody:
      'We will reserve a unique OLYVIA order number first, then render the requisition form in your selected language.',
    english: 'English',
    french: 'Francais',
    formTitle: 'PATHOLOGY REQUISITION FORM',
    banner:
      '!!!! FOR COMPLETE FILLING OF THIS FORM AND ONLINE SUBMISSION YOU WILL GET FREE MULTIVITAMINS GIFT !!!!',
    onlineForm: 'Online Form',
    patientInfo: 'PATIENT INFORMATION (Required)',
    labUseOnly: 'LAB USE ONLY',
    referringPhysician: 'REFERRING PHYSICIAN INFO. (Required)',
    insurance: 'INSURANCE/BILLING INFO. (Required)',
    facility: 'REFERRING FACILITY INFO.',
    testsOrdered: 'Tests Ordered - Please Check (Please refer to page 2 for details)',
    packages: 'PACKAGES',
    clinicalInfo: 'CLINICAL INFORMATION',
    tissueSite: 'TISSUE SPECIMEN AND SITE: LIST ALL',
    physicianSignature: 'Physician Signature',
    placeDate: 'Place/Date',
    requisitionCompletedBy: 'Requisition Completed By: Name (Last, First):',
    phoneNumber: 'Phone Number:',
    source: 'Sample Source',
    clinicalImpression: 'CLINICAL IMPRESSION',
    languageButton: 'Switch language',
    reserveNewNumber: 'Renew order number',
    backToPortal: 'Patient portal',
    submit: 'Submit requisition',
    submitting: 'Submitting requisition...',
    success:
      'The requisition was submitted successfully. Keep this OLYVIA order number for patient portal tracking and authenticity checks.',
    authenticityTitle: 'OLYVIA order authenticity',
    authenticityGood: 'Verified order',
    authenticityReserved: 'Reserved requisition number',
    authenticityBad: 'Number not found',
    authenticityLookup: 'This page confirms whether a QR or order number was issued by OLYVIA.',
  },
  fr: {
    chooseLanguage: 'Choisissez la langue de votre formulaire',
    chooseLanguageBody:
      "Nous allons d'abord reserver un numero de commande OLYVIA unique, puis afficher le formulaire de demande dans la langue choisie.",
    english: 'English',
    french: 'Francais',
    formTitle: "FORMULAIRE DE DEMANDE D'EXAMEN ANATOMOPATHOLOGIQUE",
    banner:
      '!!!! POUR AVOIR REMPLI CE FORMULAIRE ET L’AVOIR ENVOYE EN LIGNE, VOUS RECEVREZ GRATUITEMENT UN CADEAU DE MULTIVITAMINES !!!!',
    onlineForm: 'Online Form',
    patientInfo: 'INFORMATIONS SUR LE PATIENT (obligatoires)',
    labUseOnly: "A L'USAGE EXCLUSIF DU LABORATOIRE",
    referringPhysician: 'INFORMATIONS SUR LE MEDECIN TRAITANT (obligatoires)',
    insurance: "INFORMATIONS SUR L'ASSURANCE/LA FACTURATION (obligatoire)",
    facility: "INFORMATIONS SUR L'ETABLISSEMENT DE REFERENCE",
    testsOrdered:
      'Tests demandes - Veuillez cocher (Veuillez vous reporter a la page 2 pour de precisions)',
    packages: 'PACKAGES',
    clinicalInfo: 'INFORMATIONS CLINIQUES',
    tissueSite: 'ECHANTILLON DE TISSU ET SITE : LISTEZ TOUS',
    physicianSignature: 'Signature du medecin',
    placeDate: 'Lieu/Date',
    requisitionCompletedBy: 'Demande remplie par: Nom (nom, prenom):',
    phoneNumber: 'Numero de telephone:',
    source: "Source de l'echantillon",
    clinicalImpression: 'IMPRESSION CLINIQUE',
    languageButton: 'Changer la langue',
    reserveNewNumber: 'Renouveler le numero',
    backToPortal: 'Portail patient',
    submit: 'Envoyer la demande',
    submitting: 'Envoi de la demande...',
    success:
      'Le formulaire a ete envoye avec succes. Conservez ce numero OLYVIA pour le suivi dans le portail patient et pour les controles d’authenticite.',
    authenticityTitle: "Authenticite du numero OLYVIA",
    authenticityGood: 'Commande verifiee',
    authenticityReserved: 'Numero reserve',
    authenticityBad: 'Numero introuvable',
    authenticityLookup:
      'Cette page confirme si un QR code ou un numero de commande a bien ete emis par OLYVIA.',
  },
} as const

const fieldLabels = {
  en: {
    patientName: 'Name (Last First):',
    slides: 'Number of Slides:',
    blocks: 'Number of blocks:',
    arrival: 'Date/Time of sample arrival:',
    dob: 'Date of Birth:',
    age: 'Age:',
    sex: 'Sex:',
    male: 'Male',
    female: 'Female',
    other: 'Other',
    ethnicity: 'Ethnicity:',
    address: 'Address:',
    city: 'City:',
    region: 'Region/Province:',
    physicianName: 'Name:',
    mobile: 'Mobile Number:',
    email: 'E-mail:',
    sendResultsMe: 'Send Results to me (Please check)',
    sendResultsPatient: 'Send Results to Patient (Please check)',
    billInsurance: 'Bill Insurance / Employer',
    insuranceName: 'Name of Insurance:',
    insuranceNumber: 'Insurance Number:',
    policyHolder: 'Policy Holder:',
    contact: 'Tel. Contact:',
    billSelf: 'Bill Client / Self Pay',
    guarantor: 'Family member / Guarantor:',
    guarantorName: 'Name:',
    facilityNameAddress: 'Name/Address:',
    collectionDate: 'Date of Collection:',
    collectionTime: 'Time of Collection:',
    diagnosis: 'Diagnosis:',
    clinicalHistory: 'Clinical History:',
    specimenType: 'Specimen Type / TISSUE',
    formalinAddedTime: 'Formalin Added Time:',
    preOpDiagnosis: 'Pre-Operative Diagnosis:',
    postOpDiagnosis: 'Post-Operative Diagnosis:',
    medicalHistory: 'Medical History:',
    additionalRequests: 'Additional Requests/Comments',
    otherTests: 'Other Tests: Please write',
    fluid: 'Fluid (Effusions, Ascitis, CSF, Urine, BAL etc., Specify)',
    biopsyMultiple:
      'Biopsy/Multiple (State Source & Clinical Impression of Each Specimen Below)',
    surgicalResection: 'Surgical Resection',
    gynPap: 'Gyn (PAP), Provide LMP and History Below',
    boneMarrow: 'Bone Marrow',
    boneMarrowAspirate: 'Bone Marrow Aspirate',
    blood: 'Blood',
    slidesFlag: 'Slides',
    cassette: 'Cassette / Paraffin Block',
  },
  fr: {
    patientName: 'Nom (nom prenom):',
    slides: 'Nombre de lames:',
    blocks: 'Nombre de blocs:',
    arrival: "Date/heure d'arrivee de l'echantillon:",
    dob: 'Date de naissance:',
    age: 'Age:',
    sex: 'Sexe:',
    male: 'Homme',
    female: 'Femme',
    other: 'Autre',
    ethnicity: 'Ethnique:',
    address: 'Adresse:',
    city: 'Ville:',
    region: 'Region/Province:',
    physicianName: 'Nom:',
    mobile: 'Numero de portable:',
    email: 'E-mail:',
    sendResultsMe: "M'envoyer les resultats (veuillez cocher)",
    sendResultsPatient: 'Envoyer les resultats au patient (veuillez cocher)',
    billInsurance: "Facturer l'assurance/l'employeur",
    insuranceName: "Nom de l'assurance:",
    insuranceNumber: "Numero d'assurance:",
    policyHolder: 'Titulaire de la police:',
    contact: 'Tel. Contact:',
    billSelf: 'Facturer au client / Paiement par le patient',
    guarantor: 'Membre de la famille / Garant:',
    guarantorName: 'Nom:',
    facilityNameAddress: 'Nom/Adresse:',
    collectionDate: 'Date du prelevement:',
    collectionTime: 'Heure du prelevement:',
    diagnosis: 'Diagnostic:',
    clinicalHistory: 'Antecedents cliniques:',
    specimenType: "Type d'echantillon / TISSU",
    formalinAddedTime: "Heure d'ajout du formol:",
    preOpDiagnosis: 'Diagnostic preoperatoire:',
    postOpDiagnosis: 'Diagnostic postoperatoire:',
    medicalHistory: 'Antecedents medicaux:',
    additionalRequests: 'Demandes supplementaires/Commentaires',
    otherTests: 'Autres tests: Veuillez ecrire',
    fluid: 'Liquide (epanchements, ascite, LCR, urine, LBA, etc., precisez)',
    biopsyMultiple:
      "Biopsie/Multiple (indiquez la source et l'impression clinique de chaque echantillon ci-dessous)",
    surgicalResection: 'Resection chirurgicale',
    gynPap: 'Gynecologie (PAP), indiquer la DDM et les antecedents ci-dessous',
    boneMarrow: 'Moelle osseuse',
    boneMarrowAspirate: 'Aspiration de moelle osseuse',
    blood: 'Sang',
    slidesFlag: 'Lames',
    cassette: 'Cassette / Bloc de paraffine',
  },
} as const

const testLabelByLanguage: Record<
  string,
  {
    en: string
    fr: string
  }
> = {
  'test-cy-f-001': { en: 'Body Fluids Cytology', fr: 'Cytologie des liquides biologiques' },
  'test-cy-f-002': { en: 'Cervical Cancer Screening (Pap)', fr: 'Depistage du cancer du col (Pap)' },
  'test-he-b-002': { en: 'Blood Cytology', fr: 'Cytologie sanguine' },
  'test-he-bm-003': { en: 'Bone Marrow Aspirate Cytology', fr: 'Cytologie de ponction de moelle osseuse' },
  'test-he-bm-001': { en: 'Flow Cytometry (FACS) / Leukemia Immunophenotyping', fr: 'Cytometrie en flux (FACS) / immunophenotypage leucemie' },
  'test-hi-t-001': { en: 'Biopsy Examination', fr: 'Examen biopsique' },
  'test-hi-t-002': { en: 'Biopsy Examination - Multiple Samples / Prostate Biopsies', fr: 'Examen biopsique - echantillons multiples / biopsies prostatiques' },
  'test-hi-t-003': { en: 'Resection Specimen Histopathology - Small Specimen', fr: 'Histopathologie de piece operatoire - petite piece' },
  'test-hi-t-004': { en: 'Resection Specimen Histopathology - Large Specimen', fr: 'Histopathologie de piece operatoire - grande piece' },
  'test-hs-t-005': { en: 'Special Stains', fr: 'Colorations speciales' },
  'test-im-t-01': { en: 'Tumor Subtyping & IHC', fr: 'Sous-typage tumoral et IHC' },
  'test-im-t-02': { en: 'IHC with 1-2 Antibodies', fr: 'IHC avec 1-2 anticorps' },
  'test-im-t-03': { en: 'IHC with 3-5 Antibodies', fr: 'IHC avec 3-5 anticorps' },
  'test-im-t-04': { en: 'IHC with > 5 Antibodies', fr: 'IHC avec plus de 5 anticorps' },
  'test-im-t-05': { en: 'PD-L1 Expression', fr: 'Expression PD-L1' },
  'test-im-t-06': { en: 'TP-53 Mutation', fr: 'Mutation TP-53' },
  'test-bt-b-001': { en: 'Tumor Marker Panel', fr: 'Panel de marqueurs tumoraux' },
  'test-co-t-01': { en: 'Expert Revision (International)', fr: 'Revision experte internationale' },
  'test-co-t-02': { en: 'Expert Revision (Local)', fr: 'Revision experte locale' },
  'test-co-n-03': { en: 'X.PATH Labs Therapeutic Strategy', fr: 'Strategie therapeutique X.PATH Labs' },
  'test-pk-t-001': { en: 'Comprehensive Diagnostic Package - Tumor', fr: 'Forfait diagnostic complet - tumeur' },
  'test-pk-bm-002': { en: 'Comprehensive Diagnostic Package - Bone Marrow', fr: 'Forfait diagnostic complet - moelle osseuse' },
  'test-mo-b-001': { en: 'BRCA1/2 Germline Mutation Test', fr: 'Test mutation germinale BRCA1/2' },
  'test-mo-t-002': { en: 'BRCA 1/2 Somatic Mutation', fr: 'Mutation somatique BRCA 1/2' },
  'test-mo-t-003': { en: 'KRAS/NRAS/BRAF/PIK3CA Mutation', fr: 'Mutation KRAS/NRAS/BRAF/PIK3CA' },
  'test-mo-b-004': { en: 'BCR-ABL Quantitative', fr: 'BCR-ABL quantitatif' },
  'test-mo-b-05': { en: 'JAK2 Mutation', fr: 'Mutation JAK2' },
  'test-mo-s-06': { en: 'Paternity Test', fr: 'Test de paternite' },
}

function localizedTestLabel(test: TestType, language: FormLanguage) {
  return testLabelByLanguage[test._id]?.[language] ?? test.name
}

function createEmptySpecimenRows() {
  return Array.from({ length: 6 }, () => ({
    source: '',
    clinicalImpression: '',
  }))
}

function createInitialFormState(): RequisitionFormState {
  return {
    patient: {
      firstName: '',
      lastName: '',
      dateOfBirth: '',
      gender: 'female',
      phone: '',
      email: '',
      address: '',
      ethnicity: '',
    },
    physicianSignatureName: '',
    placeDate: '',
    requisitionCompletedBy: '',
    requisitionCompletedByPhone: '',
    referringPhysicianName: '',
    referringPhysicianAddress: '',
    referringPhysicianCity: '',
    referringPhysicianRegion: '',
    referringPhysicianPhone: '',
    referringPhysicianEmail: '',
    sendResultsToPhysician: true,
    sendResultsToPatient: false,
    referringFacilityName: '',
    referringFacilityAddress: '',
    billingMode: 'self_pay',
    insuranceName: '',
    insuranceNumber: '',
    policyHolder: '',
    insuranceContactPhone: '',
    guarantorName: '',
    guarantorPhone: '',
    collectionDate: '',
    collectionTime: '',
    diagnosis: '',
    preOperativeDiagnosis: '',
    postOperativeDiagnosis: '',
    medicalHistory: '',
    clinicalHistory: '',
    additionalRequests: '',
    specimenType: '',
    formalinAddedTime: '',
    otherTestsRequested: '',
    testTypeIds: [],
    specimenFlags: {
      fluid: false,
      biopsyMultiple: false,
      surgicalResection: false,
      gynPap: false,
      boneMarrow: false,
      boneMarrowAspirate: false,
      blood: false,
      slides: false,
      cassetteParaffinBlock: false,
    },
    specimenRows: createEmptySpecimenRows(),
  }
}

function calculateAge(dateOfBirth: string) {
  if (!dateOfBirth) {
    return ''
  }
  const dob = new Date(dateOfBirth)
  if (Number.isNaN(dob.getTime())) {
    return ''
  }
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const monthDelta = today.getMonth() - dob.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < dob.getDate())) {
    age -= 1
  }
  return age >= 0 ? String(age) : ''
}

function formatPatientName(lastName: string, firstName: string) {
  return [lastName.trim(), firstName.trim()].filter(Boolean).join(' ')
}

function parsePatientName(raw: string) {
  const normalized = raw.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return { lastName: '', firstName: '' }
  }

  if (normalized.includes(',')) {
    const [lastNamePart = '', ...firstNameParts] = normalized.split(',')
    return {
      lastName: lastNamePart.trim(),
      firstName: firstNameParts.join(' ').trim(),
    }
  }

  const parts = normalized.split(' ')
  if (parts.length === 1) {
    return {
      lastName: parts[0],
      firstName: '',
    }
  }

  return {
    lastName: parts.slice(0, -1).join(' ').trim(),
    firstName: parts.at(-1)?.trim() ?? '',
  }
}

function formLineValue(value?: string | null) {
  return value?.trim() ? value : ' '
}

function FormShell({
  children,
  noTranslate = false,
}: {
  children: ReactNode
  noTranslate?: boolean
}) {
  return (
    <Box
      data-no-translate={noTranslate ? 'true' : undefined}
      sx={{
        minHeight: '100vh',
        bgcolor: '#edf2f8',
        backgroundImage:
          'radial-gradient(circle at top right, rgba(21,101,192,0.12), transparent 28%), linear-gradient(180deg, #f8fbff, #edf2f8)',
        py: { xs: 3, md: 5 },
      }}
    >
      <Box sx={{ maxWidth: 1240, mx: 'auto', px: { xs: 2, md: 3 } }}>{children}</Box>
    </Box>
  )
}

function PageSheet({ children }: { children: ReactNode }) {
  return (
    <Paper
      elevation={0}
      sx={{
        mx: 'auto',
        width: '100%',
        maxWidth: 1120,
        bgcolor: 'white',
        borderRadius: { xs: 3, md: 1.5 },
        border: '1px solid #b7c3d7',
        overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(32, 56, 85, 0.12)',
      }}
    >
      {children}
    </Paper>
  )
}

function SectionRibbon({ title }: { title: string }) {
  return (
    <Box
      sx={{
        px: 1,
        py: 0.55,
        bgcolor: '#233d7f',
        color: 'white',
        fontWeight: 700,
        fontSize: 12,
        lineHeight: 1.15,
        textTransform: 'uppercase',
      }}
    >
      {title}
    </Box>
  )
}

function Cell({
  children,
  label,
  minHeight = 46,
}: {
  children?: React.ReactNode
  label?: string
  minHeight?: number
}) {
  return (
    <Box
      sx={{
        minHeight,
        borderRight: '1px solid #a6b1c2',
        borderBottom: '1px solid #a6b1c2',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {label ? (
        <Typography sx={{ px: 0.8, pt: 0.45, fontSize: 10.5, lineHeight: 1.15, color: '#22314f' }}>
          {label}
        </Typography>
      ) : null}
      <Box sx={{ px: 0.7, pb: 0.3, flex: 1, display: 'flex', alignItems: 'center' }}>{children}</Box>
    </Box>
  )
}

function PlainInput(props: React.ComponentProps<typeof InputBase>) {
  return (
    <InputBase
      fullWidth
      {...props}
      sx={{
        fontSize: 12.5,
        lineHeight: 1.35,
        alignItems: props.multiline ? 'flex-start' : 'center',
        '& .MuiInputBase-input': {
          px: 0,
          py: 0.3,
        },
        '& textarea': {
          resize: 'vertical',
        },
      }}
    />
  )
}

function CompactCheckbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 22 }}>
      <Checkbox
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        size="small"
        sx={{ p: 0.25, mr: 0.45 }}
      />
      <Typography sx={{ fontSize: 11.2, lineHeight: 1.2 }}>{label}</Typography>
    </Box>
  )
}

function ReferenceTable({
  columns,
  rows,
}: {
  columns: string[]
  rows: Array<{ [key: string]: string }>
}) {
  const keys = Object.keys(rows[0] ?? {})
  return (
    <Box sx={{ border: '1px solid #c2cad9' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1.2fr 1.3fr 1.7fr', bgcolor: '#eef3fb' }}>
        {columns.map((column) => (
          <Box
            key={column}
            sx={{
              px: 1.25,
              py: 1,
              borderRight: '1px solid #c2cad9',
              '&:last-of-type': { borderRight: 0 },
            }}
          >
            <Typography sx={{ fontWeight: 700, fontSize: 12.5 }}>{column}</Typography>
          </Box>
        ))}
      </Box>
      {rows.map((row, index) => (
        <Box
          key={`${Object.values(row).join('-')}-${index}`}
          sx={{
            display: 'grid',
            gridTemplateColumns: '1.2fr 1.3fr 1.7fr',
            borderTop: index === 0 ? 0 : '1px solid #c2cad9',
          }}
        >
          {keys.map((key, columnIndex) => (
            <Box
              key={key}
              sx={{
                px: 1.25,
                py: 1,
                borderRight: columnIndex === keys.length - 1 ? 0 : '1px solid #c2cad9',
              }}
            >
              <Typography sx={{ fontSize: 12.5, lineHeight: 1.45 }}>{row[key]}</Typography>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}

function OrderLanguageSelector({
  onSelect,
  loading,
}: {
  onSelect: (language: FormLanguage) => void
  loading: boolean
}) {
  return (
    <FormShell noTranslate>
      <Paper
        elevation={0}
        sx={{
          maxWidth: 760,
          mx: 'auto',
          p: { xs: 3, md: 4 },
          borderRadius: 4,
          border: '1px solid #d5deea',
          boxShadow: '0 24px 64px rgba(13, 30, 66, 0.12)',
        }}
      >
        <Stack spacing={3} alignItems="center" textAlign="center">
          <BrandLogo sx={{ width: { xs: 230, md: 310 } }} />
          <Box>
            <Typography variant="h4">{copy.en.chooseLanguage}</Typography>
            <Typography color="text.secondary" sx={{ mt: 1.25 }}>
              {copy.en.chooseLanguageBody}
            </Typography>
            <Typography color="text.secondary">{copy.fr.chooseLanguageBody}</Typography>
          </Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ width: '100%' }}>
            <Button
              fullWidth
              size="large"
              variant="contained"
              disabled={loading}
              onClick={() => onSelect('en')}
            >
              {loading ? <CircularProgress size={20} color="inherit" /> : copy.en.english}
            </Button>
            <Button
              fullWidth
              size="large"
              variant="outlined"
              disabled={loading}
              onClick={() => onSelect('fr')}
            >
              {copy.fr.french}
            </Button>
          </Stack>
          <Typography color="text.secondary" variant="body2">
            A unique requisition number and QR authenticity record are created as soon as you choose a language.
          </Typography>
        </Stack>
      </Paper>
    </FormShell>
  )
}

export function OrderOnlinePage() {
  const configState = useLoadable<PublicConfig | null>(null, [], async () => {
    const response = await api.get<PublicConfig>('/public/config')
    return response.data
  })
  const servicesState = useLoadable<TestType[]>([], [], async () => {
    const response = await api.get<TestType[]>('/public/services')
    return response.data
  })

  const [language, setLanguage] = useState<FormLanguage | null>(null)
  const [session, setSession] = useState<OrderFormSession | null>(null)
  const [form, setForm] = useState<RequisitionFormState>(createInitialFormState)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [consentGiven, setConsentGiven] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ orderNumber: string; message: string } | null>(null)
  const [qrSrc, setQrSrc] = useState('')

  const formCopy = language ? copy[language] : copy.en
  const labels = language ? fieldLabels[language] : fieldLabels.en
  const config = configState.data
  const services = servicesState.data
  const serviceMap = useMemo(() => new Map(services.map((item) => [item._id, item])), [services])

  const authenticityUrl = useMemo(() => {
    if (!session || typeof window === 'undefined') {
      return ''
    }
    const url = new URL('/order-authenticity', window.location.origin)
    url.searchParams.set('orderNumber', session.orderNumber)
    url.searchParams.set('token', session.verificationToken)
    return url.toString()
  }, [session])

  const sessionExpired = session ? Date.now() >= new Date(session.expiresAt).getTime() : false
  const age = calculateAge(form.patient.dateOfBirth)

  useEffect(() => {
    let cancelled = false
    if (!authenticityUrl) {
      setQrSrc('')
      return
    }
    void QRCode.toDataURL(authenticityUrl, {
      width: 104,
      margin: 1,
      color: {
        dark: '#0f274d',
        light: '#ffffff',
      },
    }).then((dataUrl: string) => {
      if (!cancelled) {
        setQrSrc(dataUrl)
      }
    })

    return () => {
      cancelled = true
    }
  }, [authenticityUrl])

  const requestSession = async (selectedLanguage: FormLanguage) => {
    setSessionLoading(true)
    setError(null)
    try {
      const response = await api.post<OrderFormSession>('/public/order-form-session', {
        language: selectedLanguage,
      })
      setLanguage(selectedLanguage)
      setSession(response.data)
      setSuccess(null)
      return response.data
    } catch (sessionError) {
      setError(errorMessage(sessionError))
      return null
    } finally {
      setSessionLoading(false)
    }
  }

  const switchLanguage = (selectedLanguage: FormLanguage) => {
    setLanguage(selectedLanguage)
    setSession((current) => (current ? { ...current, language: selectedLanguage } : current))
    setError(null)
  }

  const resetForm = async () => {
    setForm(createInitialFormState())
    setSuccess(null)
    if (language) {
      await requestSession(language)
    } else {
      setSession(null)
    }
  }

  const toggleTest = (testId: string, checked: boolean) => {
    setForm((current) => ({
      ...current,
      testTypeIds: checked
        ? [...current.testTypeIds, testId]
        : current.testTypeIds.filter((entry) => entry !== testId),
    }))
  }

  const validateForm = () => {
    const problems: string[] = []
    if (!form.patient.firstName.trim() || !form.patient.lastName.trim()) {
      problems.push('Patient name is required.')
    }
    if (!form.patient.dateOfBirth) {
      problems.push('Patient date of birth is required.')
    }
    if (!form.patient.phone.trim()) {
      problems.push('Patient phone number is required.')
    }
    if (!form.patient.email.trim()) {
      problems.push('Patient email is required.')
    }
    if (!form.patient.address.trim()) {
      problems.push('Patient address is required.')
    }
    if (!form.referringPhysicianName.trim()) {
      problems.push('Referring physician name is required.')
    }
    if (!form.referringPhysicianPhone.trim()) {
      problems.push('Referring physician phone number is required.')
    }
    if (!form.collectionDate) {
      problems.push('Collection date is required.')
    }
    if (!form.diagnosis.trim() && !form.clinicalHistory.trim()) {
      problems.push('Enter a diagnosis or clinical history.')
    }
    if (!form.testTypeIds.length) {
      problems.push('Select at least one listed test.')
    }
    if (form.billingMode === 'insurance_employer' && !form.insuranceName.trim()) {
      problems.push('Insurance name is required for insurance billing.')
    }
    if (form.billingMode === 'guarantor' && !form.guarantorName.trim()) {
      problems.push('Guarantor name is required when guarantor billing is selected.')
    }
    return problems
  }

  const submit = async () => {
    const problems = validateForm()
    if (problems.length) {
      setError(problems[0])
      return
    }
    if (!consentGiven) {
      setError(
        language === 'fr'
          ? 'Vous devez accepter la politique de confidentialité et donner votre consentement au traitement de vos données de santé avant de soumettre.'
          : 'You must accept the privacy policy and consent to health data processing before submitting.',
      )
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      let activeSession = session
      if (!language) {
        throw new Error('Select a requisition language first.')
      }
      if (!activeSession || sessionExpired) {
        activeSession = await requestSession(language)
        if (!activeSession) {
          throw new Error('Could not reserve a valid order number. Please try again.')
        }
      }

      const payload = {
        reservationId: activeSession.reservationId,
        orderNumber: activeSession.orderNumber,
        patient: {
          firstName: form.patient.firstName.trim(),
          lastName: form.patient.lastName.trim(),
          dateOfBirth: form.patient.dateOfBirth,
          gender: form.patient.gender,
          phone: form.patient.phone.trim(),
          email: form.patient.email.trim(),
          address: form.patient.address.trim(),
          ethnicity: form.patient.ethnicity.trim(),
          consentGiven: true,
          consentTimestamp: new Date().toISOString(),
          consentVersion: '1.0',
        },
        testTypeIds: form.testTypeIds,
        requisition: {
          language,
          physicianSignatureName: form.physicianSignatureName.trim(),
          placeDate: form.placeDate.trim(),
          requisitionCompletedBy: form.requisitionCompletedBy.trim(),
          requisitionCompletedByPhone: form.requisitionCompletedByPhone.trim(),
          patientEthnicity: form.patient.ethnicity.trim(),
          referringPhysicianName: form.referringPhysicianName.trim(),
          referringPhysicianAddress: form.referringPhysicianAddress.trim(),
          referringPhysicianCity: form.referringPhysicianCity.trim(),
          referringPhysicianRegion: form.referringPhysicianRegion.trim(),
          referringPhysicianPhone: form.referringPhysicianPhone.trim(),
          referringPhysicianEmail: form.referringPhysicianEmail.trim(),
          sendResultsToPhysician: form.sendResultsToPhysician,
          sendResultsToPatient: form.sendResultsToPatient,
          referringFacilityName: form.referringFacilityName.trim(),
          referringFacilityAddress: form.referringFacilityAddress.trim(),
          billingMode: form.billingMode,
          insuranceName: form.insuranceName.trim(),
          insuranceNumber: form.insuranceNumber.trim(),
          policyHolder: form.policyHolder.trim(),
          insuranceContactPhone: form.insuranceContactPhone.trim(),
          guarantorName: form.guarantorName.trim(),
          guarantorPhone: form.guarantorPhone.trim(),
          collectionDate: form.collectionDate,
          collectionTime: form.collectionTime,
          diagnosis: form.diagnosis.trim(),
          preOperativeDiagnosis: form.preOperativeDiagnosis.trim(),
          postOperativeDiagnosis: form.postOperativeDiagnosis.trim(),
          medicalHistory: form.medicalHistory.trim(),
          clinicalHistory: form.clinicalHistory.trim(),
          additionalRequests: form.additionalRequests.trim(),
          specimenType: form.specimenType.trim(),
          formalinAddedTime: form.formalinAddedTime,
          otherTestsRequested: form.otherTestsRequested.trim(),
          specimenFlags: form.specimenFlags,
          specimenRows: form.specimenRows
            .map((row) => ({
              source: row.source.trim(),
              clinicalImpression: row.clinicalImpression.trim(),
            }))
            .filter((row) => row.source || row.clinicalImpression),
        },
      }

      const response = await api.post<{ message: string; orderNumber: string }>(
        '/public/order-request',
        payload,
      )
      setSuccess({
        orderNumber: response.data.orderNumber,
        message: response.data.message,
      })
    } catch (submitError) {
      setError(errorMessage(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  if (configState.loading || servicesState.loading) {
    return <LoadingPanel label="Loading requisition form..." />
  }

  if (configState.error || servicesState.error || !config) {
    return (
      <FormShell noTranslate>
        <PageError message={configState.error ?? servicesState.error ?? 'Could not load the order requisition form.'} />
      </FormShell>
    )
  }

  if (!language || !session) {
    return <OrderLanguageSelector onSelect={requestSession} loading={sessionLoading} />
  }

  const regularTests = regularTestIds.filter((testId) => serviceMap.has(testId))
  const packageTests = packageTestIds.filter((testId) => serviceMap.has(testId))

  return (
    <FormShell noTranslate>
      <Stack spacing={2.25}>
        <Paper
          elevation={0}
          sx={{
            px: { xs: 2, md: 2.5 },
            py: { xs: 1.5, md: 1.75 },
            borderRadius: 3,
            border: '1px solid #d2d9e4',
          }}
        >
          <OcrOrderUpload
            title="Scan requisition attachments"
            buildCorrections={() => ({
              source: 'patient_portal',
              patient: {
                firstName: form.patient.firstName.trim(),
                lastName: form.patient.lastName.trim(),
                dateOfBirth: form.patient.dateOfBirth,
                phone: form.patient.phone.trim(),
                email: form.patient.email.trim(),
              },
              testCodes: form.testTypeIds,
              clinician: form.referringPhysicianName.trim() ? {
                name: form.referringPhysicianName.trim(),
                email: form.referringPhysicianEmail.trim(),
                phone: form.referringPhysicianPhone.trim(),
              } : undefined,
              clinicalNotes: [
                form.diagnosis.trim(),
                form.medicalHistory.trim(),
                form.clinicalHistory.trim(),
                form.additionalRequests.trim(),
              ].filter(Boolean).join('\n\n'),
            })}
            onOrderCreated={(order) => setSuccess({ orderNumber: order.orderNumber, message: formCopy.success })}
          />
        </Paper>

        <Paper
          elevation={0}
          sx={{
            maxWidth: 1120,
            mx: 'auto',
            p: { xs: 2, md: 2.5 },
            borderRadius: 3,
            border: '1px solid #d2d9e4',
          }}
        >
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            justifyContent="space-between"
            spacing={2}
            alignItems={{ xs: 'flex-start', md: 'center' }}
          >
            <Stack spacing={0.35}>
              <BrandLogo sx={{ width: { xs: 220, md: 280 } }} />
              <Typography variant="body2" color="text.secondary">
                {config.contactAddress}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {config.contactPhone} • {config.contactEmail}
              </Typography>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.2}>
              <Button variant="outlined" onClick={() => switchLanguage(language === 'en' ? 'fr' : 'en')}>
                {formCopy.languageButton}
              </Button>
              <Button variant="outlined" onClick={() => void requestSession(language)}>
                {formCopy.reserveNewNumber}
              </Button>
              <Button component={RouterLink} to="/patient-portal" variant="contained">
                {formCopy.backToPortal}
              </Button>
            </Stack>
          </Stack>
        </Paper>

        {success ? (
          <Alert
            severity="success"
            action={
              <Button color="inherit" size="small" onClick={() => void resetForm()}>
                Start another requisition
              </Button>
            }
          >
            <strong>{success.orderNumber}</strong>. {formCopy.success}
          </Alert>
        ) : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
        {sessionExpired ? (
          <Alert severity="warning">
            The reserved QR and order number have expired. Renew the number before final submission.
          </Alert>
        ) : null}

        <PageSheet>
          <Box sx={{ px: 1.1, pt: 0.9, pb: 0.2 }}>
            <Box
              sx={{
                display: 'grid',
                gap: 1,
                gridTemplateColumns: { xs: '1fr', md: '1.15fr 1fr 1fr' },
                alignItems: 'start',
              }}
            >
              <Stack spacing={0.15} sx={{ fontSize: 11.2, color: '#24324d' }}>
                <Typography sx={{ fontSize: 11.2 }}>
                  Lieu: Rue 6460 Mbankolo (Petit Paris)
                </Typography>
                <Typography sx={{ fontSize: 11.2 }}>BP: 35444, Yaounde - Cameroon</Typography>
                <Typography sx={{ fontSize: 11.2 }}>
                  Tel: +237-691193779 / +237-677804723
                </Typography>
                <Typography sx={{ fontSize: 11.2 }}>E-mail: info@xpath-labs.com</Typography>
                <Typography sx={{ fontSize: 11.2 }}>Website: www.xpath-labs.com</Typography>
              </Stack>

              <Stack alignItems="center" spacing={0.45}>
                <BrandLogo sx={{ width: { xs: 220, md: 245 } }} />
                <Typography
                  sx={{
                    color: '#233d7f',
                    fontWeight: 800,
                    fontSize: { xs: 20, md: 22 },
                    letterSpacing: 0.4,
                    textAlign: 'center',
                  }}
                >
                  {formCopy.formTitle}
                </Typography>
              </Stack>

              <Stack spacing={0.45} alignItems="stretch">
                <Typography sx={{ fontSize: 11.2, fontWeight: 700, color: '#233d7f', textAlign: 'right' }}>
                  {formCopy.onlineForm}
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 0.9 }}>
                  <Box
                    sx={{
                      border: '1px solid #b7c3d7',
                      minHeight: 86,
                      display: 'grid',
                      placeItems: 'center',
                      bgcolor: 'white',
                    }}
                  >
                    {qrSrc ? (
                      <Box component="img" src={qrSrc} alt="Order authenticity QR code" sx={{ width: 80, height: 80 }} />
                    ) : (
                      <CircularProgress size={24} />
                    )}
                  </Box>
                  <Box
                    sx={{
                      minHeight: 86,
                      px: 1.2,
                      py: 1,
                      bgcolor: '#f3dfe6',
                      border: '1px solid #e6bdcc',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                    }}
                  >
                    <Typography sx={{ fontSize: 10.5, textTransform: 'uppercase', color: '#6a3d53' }}>
                      OLYVIA Order Number
                    </Typography>
                    <Typography sx={{ fontSize: 20, fontWeight: 800, color: '#23314d' }}>
                      {session.orderNumber}
                    </Typography>
                    <Typography sx={{ fontSize: 10.5, color: '#5e6572' }}>
                      Expires {formatDateTime(session.expiresAt)}
                    </Typography>
                  </Box>
                </Box>
              </Stack>
            </Box>
          </Box>

          <Box
            sx={{
              mx: 1.1,
              mt: 0.5,
              px: 1,
              py: 0.35,
              bgcolor: '#cfd8e8',
              color: '#23314d',
              textAlign: 'center',
              fontWeight: 700,
              fontSize: 11.2,
              lineHeight: 1.2,
            }}
          >
            {formCopy.banner}
          </Box>

          <Box sx={{ mx: 1.1, mt: 0.5, borderLeft: '1px solid #a6b1c2', borderTop: '1px solid #a6b1c2' }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
              <Box>
                <SectionRibbon title={formCopy.patientInfo} />
                <Box sx={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr' }}>
                  <Cell label={labels.patientName}>
                    <PlainInput
                      value={formatPatientName(form.patient.lastName, form.patient.firstName)}
                      placeholder={language === 'fr' ? 'Nom Prenom' : 'Last First'}
                      onChange={(event) => {
                        const { lastName, firstName } = parsePatientName(event.target.value)
                        setForm((current) => ({
                          ...current,
                          patient: {
                            ...current.patient,
                            lastName,
                            firstName,
                          },
                        }))
                      }}
                    />
                  </Cell>
                  <Cell label={labels.address}>
                    <PlainInput
                      value={form.patient.address}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          patient: { ...current.patient, address: event.target.value },
                        }))
                      }
                    />
                  </Cell>
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 0.55fr 0.85fr 0.8fr' }}>
                  <Cell label={labels.dob}>
                    <PlainInput
                      type="date"
                      value={form.patient.dateOfBirth}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          patient: { ...current.patient, dateOfBirth: event.target.value },
                        }))
                      }
                    />
                  </Cell>
                  <Cell label={labels.age}>
                    <Typography sx={{ fontSize: 12.5, color: '#22314f' }}>{formLineValue(age)}</Typography>
                  </Cell>
                  <Cell label={labels.sex}>
                    <Stack direction="row" spacing={0.8}>
                      <CompactCheckbox
                        checked={form.patient.gender === 'male'}
                        label={labels.male}
                        onChange={() =>
                          setForm((current) => ({
                            ...current,
                            patient: { ...current.patient, gender: 'male' },
                          }))
                        }
                      />
                      <CompactCheckbox
                        checked={form.patient.gender === 'female'}
                        label={labels.female}
                        onChange={() =>
                          setForm((current) => ({
                            ...current,
                            patient: { ...current.patient, gender: 'female' },
                          }))
                        }
                      />
                      <CompactCheckbox
                        checked={form.patient.gender === 'other'}
                        label={labels.other}
                        onChange={() =>
                          setForm((current) => ({
                            ...current,
                            patient: { ...current.patient, gender: 'other' },
                          }))
                        }
                      />
                    </Stack>
                  </Cell>
                  <Cell label={labels.ethnicity}>
                    <PlainInput
                      value={form.patient.ethnicity}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          patient: { ...current.patient, ethnicity: event.target.value },
                        }))
                      }
                    />
                  </Cell>
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 0.8fr 0.9fr' }}>
                  <Cell label={labels.mobile}>
                    <PlainInput
                      value={form.patient.phone}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          patient: { ...current.patient, phone: event.target.value },
                        }))
                      }
                    />
                  </Cell>
                  <Cell label={labels.city}>
                    <PlainInput
                      value={form.referringPhysicianCity}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, referringPhysicianCity: event.target.value }))
                      }
                    />
                  </Cell>
                  <Cell label={labels.email}>
                    <PlainInput
                      value={form.patient.email}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          patient: { ...current.patient, email: event.target.value },
                        }))
                      }
                    />
                  </Cell>
                </Box>
              </Box>

              <Box>
                <SectionRibbon title={formCopy.labUseOnly} />
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                  <Cell label={labels.slides}>
                    <Typography sx={{ fontSize: 12.5, color: '#6d778a' }}> </Typography>
                  </Cell>
                  <Cell label={labels.arrival}>
                    <Typography sx={{ fontSize: 12.5, color: '#6d778a' }}> </Typography>
                  </Cell>
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr' }}>
                  <Cell label={labels.blocks}>
                    <Typography sx={{ fontSize: 12.5, color: '#6d778a' }}> </Typography>
                  </Cell>
                </Box>
                <SectionRibbon title={formCopy.referringPhysician} />
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                  <Cell label={labels.physicianName}>
                    <PlainInput
                      value={form.referringPhysicianName}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          referringPhysicianName: event.target.value,
                        }))
                      }
                    />
                  </Cell>
                  <Cell label={labels.address}>
                    <PlainInput
                      value={form.referringPhysicianAddress}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          referringPhysicianAddress: event.target.value,
                        }))
                      }
                    />
                  </Cell>
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                  <Cell label={labels.mobile}>
                    <PlainInput
                      value={form.referringPhysicianPhone}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          referringPhysicianPhone: event.target.value,
                        }))
                      }
                    />
                  </Cell>
                  <Cell label={labels.email}>
                    <PlainInput
                      value={form.referringPhysicianEmail}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          referringPhysicianEmail: event.target.value,
                        }))
                      }
                    />
                  </Cell>
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
                  <Cell label={labels.region}>
                    <PlainInput
                      value={form.referringPhysicianRegion}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          referringPhysicianRegion: event.target.value,
                        }))
                      }
                    />
                  </Cell>
                  <Cell minHeight={48}>
                    <CompactCheckbox
                      checked={form.sendResultsToPhysician}
                      label={labels.sendResultsMe}
                      onChange={(checked) =>
                        setForm((current) => ({ ...current, sendResultsToPhysician: checked }))
                      }
                    />
                  </Cell>
                  <Cell minHeight={48}>
                    <CompactCheckbox
                      checked={form.sendResultsToPatient}
                      label={labels.sendResultsPatient}
                      onChange={(checked) =>
                        setForm((current) => ({ ...current, sendResultsToPatient: checked }))
                      }
                    />
                  </Cell>
                </Box>
              </Box>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
              <Box>
                <SectionRibbon title={formCopy.insurance} />
                <Cell minHeight={138}>
                  <Stack spacing={0.4} sx={{ width: '100%' }}>
                    <CompactCheckbox
                      checked={form.billingMode === 'insurance_employer'}
                      label={labels.billInsurance}
                      onChange={() =>
                        setForm((current) => ({ ...current, billingMode: 'insurance_employer' }))
                      }
                    />
                    <PlainInput
                      placeholder={labels.insuranceName}
                      value={form.insuranceName}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, insuranceName: event.target.value }))
                      }
                    />
                    <PlainInput
                      placeholder={labels.insuranceNumber}
                      value={form.insuranceNumber}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, insuranceNumber: event.target.value }))
                      }
                    />
                    <PlainInput
                      placeholder={labels.policyHolder}
                      value={form.policyHolder}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, policyHolder: event.target.value }))
                      }
                    />
                    <PlainInput
                      placeholder={labels.contact}
                      value={form.insuranceContactPhone}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          insuranceContactPhone: event.target.value,
                        }))
                      }
                    />
                  </Stack>
                </Cell>
                <Cell minHeight={88}>
                  <Stack spacing={0.45} sx={{ width: '100%' }}>
                    <CompactCheckbox
                      checked={form.billingMode === 'self_pay'}
                      label={labels.billSelf}
                      onChange={() => setForm((current) => ({ ...current, billingMode: 'self_pay' }))}
                    />
                    <CompactCheckbox
                      checked={form.billingMode === 'guarantor'}
                      label={labels.guarantor}
                      onChange={() => setForm((current) => ({ ...current, billingMode: 'guarantor' }))}
                    />
                    <PlainInput
                      placeholder={labels.guarantorName}
                      value={form.guarantorName}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, guarantorName: event.target.value }))
                      }
                    />
                    <PlainInput
                      placeholder={labels.mobile}
                      value={form.guarantorPhone}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, guarantorPhone: event.target.value }))
                      }
                    />
                  </Stack>
                </Cell>
              </Box>

              <Box>
                <SectionRibbon title={formCopy.facility} />
                <Cell minHeight={88} label={labels.facilityNameAddress}>
                  <PlainInput
                    multiline
                    minRows={3}
                    value={[form.referringFacilityName, form.referringFacilityAddress]
                      .filter(Boolean)
                      .join('\n')}
                    onChange={(event) => {
                      const [name, ...rest] = event.target.value.split('\n')
                      setForm((current) => ({
                        ...current,
                        referringFacilityName: name ?? '',
                        referringFacilityAddress: rest.join('\n'),
                      }))
                    }}
                  />
                </Cell>

                <SectionRibbon title={formCopy.testsOrdered} />
                <Cell minHeight={278}>
                  <Stack spacing={0.15} sx={{ width: '100%' }}>
                    {regularTests.map((testId) => {
                      const test = serviceMap.get(testId)
                      return (
                        <CompactCheckbox
                          key={testId}
                          checked={form.testTypeIds.includes(testId)}
                          label={test ? localizedTestLabel(test, language) : testId}
                          onChange={(checked) => toggleTest(testId, checked)}
                        />
                      )
                    })}
                  </Stack>
                </Cell>

                <SectionRibbon title={formCopy.packages} />
                <Cell minHeight={116}>
                  <Stack spacing={0.15} sx={{ width: '100%' }}>
                    {packageTests.map((testId) => {
                      const test = serviceMap.get(testId)
                      return (
                        <CompactCheckbox
                          key={testId}
                          checked={form.testTypeIds.includes(testId)}
                          label={test ? localizedTestLabel(test, language) : testId}
                          onChange={(checked) => toggleTest(testId, checked)}
                        />
                      )
                    })}
                    <PlainInput
                      placeholder={labels.otherTests}
                      value={form.otherTestsRequested}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, otherTestsRequested: event.target.value }))
                      }
                    />
                  </Stack>
                </Cell>
              </Box>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.05fr 1fr' } }}>
              <Box>
                <SectionRibbon title={formCopy.clinicalInfo} />
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                  <Cell label={labels.collectionDate}>
                    <PlainInput
                      type="date"
                      value={form.collectionDate}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, collectionDate: event.target.value }))
                      }
                    />
                  </Cell>
                  <Cell label={labels.collectionTime}>
                    <PlainInput
                      type="time"
                      value={form.collectionTime}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, collectionTime: event.target.value }))
                      }
                    />
                  </Cell>
                </Box>
                <Cell label={labels.diagnosis} minHeight={66}>
                  <PlainInput
                    multiline
                    minRows={2}
                    value={form.diagnosis}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, diagnosis: event.target.value }))
                    }
                  />
                </Cell>
                <Cell label={labels.clinicalHistory} minHeight={78}>
                  <PlainInput
                    multiline
                    minRows={3}
                    value={form.clinicalHistory}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, clinicalHistory: event.target.value }))
                    }
                  />
                </Cell>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                  <Cell label={labels.specimenType}>
                    <PlainInput
                      value={form.specimenType}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, specimenType: event.target.value }))
                      }
                    />
                  </Cell>
                  <Cell label={labels.formalinAddedTime}>
                    <PlainInput
                      type="time"
                      value={form.formalinAddedTime}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, formalinAddedTime: event.target.value }))
                      }
                    />
                  </Cell>
                </Box>

                <SectionRibbon title={formCopy.tissueSite} />
                <Cell minHeight={96}>
                  <Box sx={{ display: 'grid', gap: 0.1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, width: '100%' }}>
                    <CompactCheckbox
                      checked={form.specimenFlags.fluid}
                      label={labels.fluid}
                      onChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          specimenFlags: { ...current.specimenFlags, fluid: checked },
                        }))
                      }
                    />
                    <CompactCheckbox
                      checked={form.specimenFlags.biopsyMultiple}
                      label={labels.biopsyMultiple}
                      onChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          specimenFlags: { ...current.specimenFlags, biopsyMultiple: checked },
                        }))
                      }
                    />
                    <CompactCheckbox
                      checked={form.specimenFlags.surgicalResection}
                      label={labels.surgicalResection}
                      onChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          specimenFlags: { ...current.specimenFlags, surgicalResection: checked },
                        }))
                      }
                    />
                    <CompactCheckbox
                      checked={form.specimenFlags.gynPap}
                      label={labels.gynPap}
                      onChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          specimenFlags: { ...current.specimenFlags, gynPap: checked },
                        }))
                      }
                    />
                    <CompactCheckbox
                      checked={form.specimenFlags.boneMarrow}
                      label={labels.boneMarrow}
                      onChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          specimenFlags: { ...current.specimenFlags, boneMarrow: checked },
                        }))
                      }
                    />
                    <CompactCheckbox
                      checked={form.specimenFlags.boneMarrowAspirate}
                      label={labels.boneMarrowAspirate}
                      onChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          specimenFlags: { ...current.specimenFlags, boneMarrowAspirate: checked },
                        }))
                      }
                    />
                    <CompactCheckbox
                      checked={form.specimenFlags.blood}
                      label={labels.blood}
                      onChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          specimenFlags: { ...current.specimenFlags, blood: checked },
                        }))
                      }
                    />
                    <CompactCheckbox
                      checked={form.specimenFlags.slides}
                      label={labels.slidesFlag}
                      onChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          specimenFlags: { ...current.specimenFlags, slides: checked },
                        }))
                      }
                    />
                    <CompactCheckbox
                      checked={form.specimenFlags.cassetteParaffinBlock}
                      label={labels.cassette}
                      onChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          specimenFlags: {
                            ...current.specimenFlags,
                            cassetteParaffinBlock: checked,
                          },
                        }))
                      }
                    />
                  </Box>
                </Cell>
              </Box>

              <Box>
                <Cell label={labels.preOpDiagnosis} minHeight={82}>
                  <PlainInput
                    multiline
                    minRows={3}
                    value={form.preOperativeDiagnosis}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        preOperativeDiagnosis: event.target.value,
                      }))
                    }
                  />
                </Cell>
                <Cell label={labels.postOpDiagnosis} minHeight={82}>
                  <PlainInput
                    multiline
                    minRows={3}
                    value={form.postOperativeDiagnosis}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        postOperativeDiagnosis: event.target.value,
                      }))
                    }
                  />
                </Cell>
                <Cell label={labels.medicalHistory} minHeight={86}>
                  <PlainInput
                    multiline
                    minRows={3}
                    value={form.medicalHistory}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, medicalHistory: event.target.value }))
                    }
                  />
                </Cell>
                <Cell label={labels.additionalRequests} minHeight={96}>
                  <PlainInput
                    multiline
                    minRows={4}
                    value={form.additionalRequests}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        additionalRequests: event.target.value,
                      }))
                    }
                  />
                </Cell>
              </Box>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <Cell label={copy[language].source} minHeight={226}>
                <Stack spacing={0.2} sx={{ width: '100%' }}>
                  {form.specimenRows.map((row, index) => (
                    <PlainInput
                      key={`source-${index}`}
                      value={row.source}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          specimenRows: current.specimenRows.map((entry, rowIndex) =>
                            rowIndex === index ? { ...entry, source: event.target.value } : entry,
                          ),
                        }))
                      }
                      placeholder={`${index + 1}-`}
                    />
                  ))}
                </Stack>
              </Cell>
              <Cell label={copy[language].clinicalImpression} minHeight={226}>
                <Stack spacing={0.2} sx={{ width: '100%' }}>
                  {form.specimenRows.map((row, index) => (
                    <PlainInput
                      key={`impression-${index}`}
                      value={row.clinicalImpression}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          specimenRows: current.specimenRows.map((entry, rowIndex) =>
                            rowIndex === index
                              ? { ...entry, clinicalImpression: event.target.value }
                              : entry,
                          ),
                        }))
                      }
                      placeholder={`${index + 1}-`}
                    />
                  ))}
                </Stack>
              </Cell>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <Cell label={formCopy.physicianSignature}>
                <PlainInput
                  value={form.physicianSignatureName}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, physicianSignatureName: event.target.value }))
                  }
                />
              </Cell>
              <Cell label={formCopy.placeDate}>
                <PlainInput
                  value={form.placeDate}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, placeDate: event.target.value }))
                  }
                />
              </Cell>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr' }}>
              <Cell label={formCopy.requisitionCompletedBy}>
                <PlainInput
                  value={form.requisitionCompletedBy}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      requisitionCompletedBy: event.target.value,
                    }))
                  }
                />
              </Cell>
              <Cell label={formCopy.phoneNumber}>
                <PlainInput
                  value={form.requisitionCompletedByPhone}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      requisitionCompletedByPhone: event.target.value,
                    }))
                  }
                />
              </Cell>
            </Box>
          </Box>

          <Box sx={{ px: 1.1, pb: 1.1 }}>
            <Box
              sx={{
                border: '1px solid #f0a3c4',
                borderTop: 0,
                bgcolor: '#fbe8ef',
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
              }}
            >
              {Array.from({ length: 10 }).map((_, index) => (
                <Box
                  key={index}
                  sx={{
                    minHeight: 34,
                    borderTop: '1px solid #f0a3c4',
                    borderRight: index % 5 === 4 ? 0 : '1px solid #f0a3c4',
                  }}
                />
              ))}
            </Box>
          </Box>
        </PageSheet>

        <PageSheet>
          <Stack spacing={2} sx={{ p: { xs: 2, md: 2.6 } }}>
            <Stack spacing={0.65}>
              <Typography variant="h5" sx={{ color: '#233d7f' }}>
                Panels IHC pour Tumeurs Solides (IHC Panels Solid Tumors)
              </Typography>
              <ReferenceTable
                columns={['Panel Name', 'Antibodies Included', 'Clinical Utility']}
                rows={solidTumorPanels.map((row) => ({
                  panel: row.panel,
                  antibodies: row.antibodies,
                  utility: row.utility,
                }))}
              />
            </Stack>

            <Stack spacing={0.65}>
              <Typography variant="h5" sx={{ color: '#233d7f' }}>
                Panels pour l’Hematopathologie (Hematopathology)
              </Typography>
              <ReferenceTable
                columns={['Panel Name', 'Antibodies Included', 'Clinical Utility']}
                rows={hematopathologyPanels.map((row) => ({
                  panel: row.panel,
                  antibodies: row.antibodies,
                  utility: row.utility,
                }))}
              />
            </Stack>

            <Stack spacing={0.65}>
              <Typography variant="h5" sx={{ color: '#233d7f' }}>
                Les Marqueurs Sanguins / Tumor Markers (Blood Tests)
              </Typography>
              <Typography color="text.secondary">
                En pathologie moleculaire, il est crucial de faire la distinction entre un marqueur pronostique et un marqueur predictif, puis de choisir les bilans de suivi adaptes a chaque type de cancer.
              </Typography>
              <ReferenceTable
                columns={['Cancer', 'Markers', 'Monitoring Utility']}
                rows={tumorMarkerRows.map((row) => ({
                  cancer: row.cancer,
                  markers: row.markers,
                  utility: row.utility,
                }))}
              />
            </Stack>

            <Divider />

            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}>
              <Box>
                <Typography fontWeight={700}>{config.labName}</Typography>
                <Typography color="text.secondary">{config.tagline}</Typography>
              </Box>
              <Stack alignItems={{ xs: 'flex-start', md: 'flex-end' }} spacing={0.35}>
                <Typography color="text.secondary">{config.contactAddress}</Typography>
                <Typography color="text.secondary">{config.contactPhone}</Typography>
                <Typography color="text.secondary">{config.contactEmail}</Typography>
              </Stack>
            </Stack>
          </Stack>
        </PageSheet>

        <Paper
          elevation={0}
          sx={{
            maxWidth: 1120,
            mx: 'auto',
            p: { xs: 2, md: 2.5 },
            borderRadius: 3,
            border: '1px solid #d2d9e4',
          }}
        >
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            justifyContent="space-between"
            spacing={2}
            alignItems={{ xs: 'flex-start', md: 'center' }}
          >
            <Stack spacing={0.35}>
              <Typography fontWeight={700}>Order authenticity link</Typography>
              <Link href={authenticityUrl} target="_blank" rel="noreferrer" underline="hover">
                {authenticityUrl}
              </Link>
            </Stack>
            <Stack spacing={1}>
              <Stack direction="row" alignItems="flex-start" spacing={1}>
                <Checkbox
                  size="small"
                  checked={consentGiven}
                  onChange={(e) => setConsentGiven(e.target.checked)}
                  sx={{ mt: -0.5 }}
                />
                <Typography variant="body2" color="text.secondary">
                  {language === 'fr'
                    ? "J'accepte la politique de confidentialité et je consens au traitement de mes données de santé conformément à la loi camerounaise n° 2010/012 du 21 décembre 2010 relative à la cybersécurité et à la protection des données personnelles."
                    : 'I accept the privacy policy and consent to the processing of my health data in accordance with Cameroon Law No. 2010/012 of 21 December 2010 on cybersecurity and personal data protection.'}
                </Typography>
              </Stack>
              <Button variant="contained" disabled={submitting || !consentGiven} onClick={submit}>
                {submitting ? formCopy.submitting : formCopy.submit}
              </Button>
            </Stack>
          </Stack>
        </Paper>
      </Stack>
    </FormShell>
  )
}

export function OrderAuthenticityPage() {
  const [searchParams] = useSearchParams()
  const orderNumber = searchParams.get('orderNumber') ?? ''
  const token = searchParams.get('token') ?? ''

  const authenticityState = useLoadable<OrderAuthenticityResponse | null>(
    null,
    [orderNumber, token],
    async () => {
      if (!orderNumber) {
        throw new Error('An order number is required for authenticity verification.')
      }
      const response = await api.get<OrderAuthenticityResponse>(
        `/public/order-authenticity/${encodeURIComponent(orderNumber)}`,
        {
          params: token ? { token } : undefined,
        },
      )
      return response.data
    },
  )

  const statusTone =
    authenticityState.data?.status === 'submitted'
      ? 'success'
      : authenticityState.data?.status === 'reserved'
        ? 'info'
        : 'error'

  const statusLabel =
    authenticityState.data?.status === 'submitted'
      ? copy.en.authenticityGood
      : authenticityState.data?.status === 'reserved'
        ? copy.en.authenticityReserved
        : copy.en.authenticityBad

  if (authenticityState.loading) {
    return <LoadingPanel label="Verifying order authenticity..." />
  }

  return (
    <FormShell noTranslate>
      <Paper
        elevation={0}
        sx={{
          maxWidth: 760,
          mx: 'auto',
          p: { xs: 3, md: 4 },
          borderRadius: 4,
          border: '1px solid #d5deea',
          boxShadow: '0 24px 64px rgba(13, 30, 66, 0.12)',
        }}
      >
        <Stack spacing={3}>
          <BrandLogo sx={{ width: { xs: 220, md: 280 }, mx: 'auto' }} />
          <Box textAlign="center">
            <Typography variant="h4">{copy.en.authenticityTitle}</Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {copy.en.authenticityLookup}
            </Typography>
          </Box>

          {authenticityState.error ? (
            <Alert severity="error">{authenticityState.error}</Alert>
          ) : null}

          {authenticityState.data ? (
            <Alert severity={statusTone}>
              <strong>{statusLabel}.</strong> {authenticityState.data.message}
            </Alert>
          ) : null}

          <Box
            sx={{
              borderRadius: 3,
              border: '1px solid #d5deea',
              overflow: 'hidden',
            }}
          >
            <Box sx={{ px: 2, py: 1.2, bgcolor: '#eef3fb' }}>
              <Typography fontWeight={700}>Verification details</Typography>
            </Box>
            <Stack spacing={1.1} sx={{ p: 2 }}>
              <Typography>
                <strong>Order number:</strong> {orderNumber || '—'}
              </Typography>
              <Typography>
                <strong>Status:</strong> {authenticityState.data?.status ?? 'not_found'}
              </Typography>
              <Typography>
                <strong>Issued by:</strong> {authenticityState.data?.labName ?? 'X.PATH Labs'}
              </Typography>
              <Typography>
                <strong>Created at:</strong> {authenticityState.data?.createdAt ? formatDateTime(authenticityState.data.createdAt) : '—'}
              </Typography>
              <Typography>
                <strong>Updated at:</strong> {authenticityState.data?.updatedAt ? formatDateTime(authenticityState.data.updatedAt) : '—'}
              </Typography>
              <Typography>
                <strong>Reservation expiry:</strong> {authenticityState.data?.expiresAt ? formatDateTime(authenticityState.data.expiresAt) : '—'}
              </Typography>
            </Stack>
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.2}>
            <Button component={RouterLink} to="/order-online" variant="contained">
              Open requisition form
            </Button>
            <Button component={RouterLink} to="/patient-portal" variant="outlined">
              Go to patient portal
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </FormShell>
  )
}
