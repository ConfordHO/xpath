import TranslateRoundedIcon from '@mui/icons-material/TranslateRounded'
import {
  Box,
  Paper,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'

import { api, storageKeys } from './api'
import { useAuth } from './auth'

export type AppLocale = 'en' | 'fr'

interface LanguageContextValue {
  locale: AppLocale
  setLocale: (locale: AppLocale, options?: { persistPreference?: boolean }) => void
  toggleLocale: () => void
  translate: (text: string) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

const exactPhrasePairs: Array<[string, string]> = [
  ['SECURE WORKSPACE', 'ESPACE SECURISE'],
  ['Sign out', 'Se deconnecter'],
  ['Account', 'Compte'],
  ['Settings', 'Parametres'],
  ['Dashboard', 'Tableau de bord'],
  ['Orders', 'Commandes'],
  ['Create order', 'Creer une commande'],
  ['Financial', 'Finances'],
  ['Courier', 'Coursier'],
  ['Receptionist workflow', 'Flux de travail reception'],
  ['Technician workflow', 'Flux de travail technicien'],
  ['Pathologist workflow', 'Flux de travail pathologiste'],
  ['Reports', 'Rapports'],
  ['Histology', 'Histologie'],
  ['IHC', 'IHC'],
  ['Cytology', 'Cytologie'],
  ['Digital pathology', 'Pathologie numerique'],
  ['Inventory', 'Inventaire'],
  ['Workflows', 'Flux de travail'],
  ['Notifications', 'Notifications'],
  ['Administration', 'Administration'],
  ['Users', 'Utilisateurs'],
  ['Doctors & referrers', 'Medecins et referents'],
  ['Test types', "Types d'analyses"],
  ['Workflow templates', 'Modeles de flux de travail'],
  ['System settings', 'Parametres du systeme'],
  ['Doctor portal', 'Portail medecin'],
  ['Enterprise', 'Entreprise'],
  ['Clinical operations', 'Operations cliniques'],
  ['Analytical modules', 'Modules analytiques'],
  ['Results & quality', 'Resultats et qualite'],
  ['Governance & compliance', 'Gouvernance et conformite'],
  ['Enterprise admin', "Administration de l'entreprise"],
  ['Module audit', 'Audit des modules'],
  ['User management', 'Gestion des utilisateurs'],
  [
    'Super admin manages the whole network. Admin is restricted to their own lab and operational staff.',
    "Le super administrateur gere l'ensemble du reseau. L'administrateur est limite a son propre laboratoire et au personnel operationnel.",
  ],
  ['Create user', 'Creer un utilisateur'],
  ['Edit user', "Modifier l'utilisateur"],
  ['Create new user', 'Creer un nouvel utilisateur'],
  ['Doctors & Referrers', 'Medecins et referents'],
  ['Add doctor / clinic', 'Ajouter un medecin / une clinique'],
  [
    'Create doctors or clinics for referral tracking. Link a portal user so they can sign in and view their referral statistics here.',
    'Creez des medecins ou des cliniques pour le suivi des referrals. Associez un utilisateur du portail afin quil puisse se connecter et consulter ici ses statistiques de referrals.',
  ],
  ['Edit doctor / clinic', 'Modifier le medecin / la clinique'],
  ['Create test type', "Creer un type d'analyse"],
  [
    'Prices use the system currency and are shown on the public landing page. Only active test types appear there.',
    "Les prix utilisent la devise du systeme et sont affiches sur la page publique. Seuls les types d'analyses actifs y apparaissent.",
  ],
  ['Edit test type', "Modifier le type d'analyse"],
  ['Lab processing workflows', 'Flux de traitement du laboratoire'],
  ['Edit workflow template', 'Modifier le modele de flux de travail'],
  [
    'System-wide configuration: language, lab name, timezone, and test types.',
    "Configuration globale du systeme : langue, nom du laboratoire, fuseau horaire et types d'analyses.",
  ],
  ['Language', 'Langue'],
  ['Public lab information (landing page & contact)', 'Informations publiques du laboratoire (page daccueil et contact)'],
  ['My account', 'Mon compte'],
  [
    'Update your name and password. Changes apply to all portals for your user.',
    "Mettez a jour votre nom et votre mot de passe. Les modifications s'appliquent a tous les portails associes a votre utilisateur.",
  ],
  ['Referrer portal', 'Portail de referent'],
  ['Referral cases', 'Cas references'],
  ['No linked referral cases.', 'Aucun cas reference lie.'],
  ['Once orders are linked to your clinician profile, they will appear here.', 'Une fois les commandes liees a votre profil clinicien, elles apparaitront ici.'],
  ['Profile', 'Profil'],
  ['Vendor connectors', 'Connecteurs fournisseurs'],
  [
    'Configure Leica tissue processor and stainer connectors, plus the Roche scanner gateway.',
    'Configurez les connecteurs Leica pour le processeur tissulaire et le colorateur, ainsi que la passerelle du scanner Roche.',
  ],
  ['Dispatch queue', "File d'envoi"],
  ['Recent jobs', 'Travaux recents'],
  ['Webhook events', 'Evenements webhook'],
  ['Requested LIMS scope review', 'Revue de la portee LIMS demandee'],
  [
    'This page tracks the 25-module brief against the current app. Functional coverage is implemented in-app, but the platform is still demo-grade rather than production-certified.',
    "Cette page compare le cahier des charges des 25 modules a l'application actuelle. La couverture fonctionnelle est implemente dans l'application, mais la plateforme reste de niveau demonstration plutot que certifiee production.",
  ],
  ['Coverage by module', 'Couverture par module'],
  ['Analytical laboratory modules', 'Modules analytiques du laboratoire'],
  ['Results, communication, and quality', 'Resultats, communication et qualite'],
  ['Governance, compliance, and integration controls', "Gouvernance, conformite et controles d'integration"],
  ['Enterprise configuration and intelligence', 'Configuration et intelligence dentreprise'],
  ['Role-focused laboratory workspace.', 'Espace de travail du laboratoire centre sur le role.'],
  [
    'Receive orders (web or walk-in) → Confirm payment → Add courier if needed → Assign to technician → Wait for results.',
    'Recevoir les commandes (web ou au guichet) → Confirmer le paiement → Ajouter un coursier si necessaire → Assigner au technicien → Attendre les resultats.',
  ],
  [
    'Orders assigned to you. Start processing to create an accession, then proceed to Histology for grossing → processing → embedding → sectioning → staining. When ready, assign a pathologist for review.',
    "Commandes qui vous sont assignees. Lancez le traitement pour creer une accession, puis passez a l'histologie pour la macroscopie → traitement → inclusion → coupe → coloration. Lorsqu'elles sont pretes, assignez un pathologiste pour la revue.",
  ],
  [
    'Open the case workspace to review accession context, write the report, complete sign-out, and release the final result.',
    "Ouvrez l'espace de travail du dossier pour revoir le contexte de l'accession, rediger le rapport, terminer la validation et publier le resultat final.",
  ],
  ['No cases are awaiting review.', "Aucun dossier n'attend une revision."],
  ['Once technicians complete staining and submit for review, cases will appear here.', 'Une fois la coloration terminee et le dossier soumis a la revision, les cas apparaitront ici.'],
  ['Grossing', 'Macroscopie'],
  ['Pending grossing', 'Macroscopies en attente'],
  ['Selected accession', 'Accession selectionnee'],
  ['Processing', 'Traitement'],
  ['Embedding', 'Inclusion'],
  ['Sectioning', 'Coupe'],
  ['Staining', 'Coloration'],
  ['IHC (Immunohistochemistry)', 'IHC (Immunohistochimie)'],
  ['Look up accession', "Rechercher une accession"],
  ['Record IHC stain', 'Enregistrer une coloration IHC'],
  ['Existing entries', 'Entrees existantes'],
  ['No IHC entries yet.', "Aucune entree IHC pour l'instant."],
  ['Record the first IHC result for the selected slide above.', 'Enregistrez ci-dessus le premier resultat IHC pour la lame selectionnee.'],
  ['Create cytology case', 'Creer un cas de cytologie'],
  ['Cases', 'Cas'],
  ['No cytology cases yet.', "Aucun cas de cytologie pour l'instant."],
  ['Create one from an order above.', 'Creez-en un a partir dune commande ci-dessus.'],
  ['Generated images', 'Images generees'],
  ['No generated images yet.', "Aucune image generee pour l'instant."],
  ['Run the simulation after entering a stained slide ID to create the digital image set.', "Lancez la simulation apres avoir saisi un identifiant de lame coloree pour creer l'ensemble dimages numeriques."],
  ['Workflow select', 'Selection de workflow'],
  ['Run reference workflow templates and record their execution in history.', "Executez les modeles de workflow de reference et enregistrez leur execution dans l'historique."],
  ['Workflow history', 'Historique des workflows'],
  ['Maviance readiness', 'Preparation Maviance'],
  ['Recent Maviance collections', 'Collectes Maviance recentes'],
  ['Payments by method', 'Paiements par methode'],
  ['Revenue (last 7 days)', 'Revenus (7 derniers jours)'],
  ['Outstanding clearance queue', "File d'attente des validations financieres"],
  ['Transactions', 'Transactions'],
  ['Pickup requests', 'Demandes de collecte'],
  ['No pickup requests right now.', "Aucune demande de collecte pour le moment."],
  ['New online orders will appear here.', 'Les nouvelles commandes en ligne apparaitront ici.'],
  ['Check in orders for courier pickup (optional)', 'Enregistrer des commandes pour la collecte du coursier (optionnel)'],
  ['No orders available to check in.', "Aucune commande disponible pour l'enregistrement."],
  ['Courier queue — track all pickups and deliveries', 'File du coursier — suivre toutes les collectes et livraisons'],
  ['No active courier jobs.', 'Aucune mission de coursier active.'],
  ['Download a PDF report to give to the patient or send to them.', 'Telechargez un rapport PDF a remettre au patient ou a lui envoyer.'],
  ['Notifications', 'Notifications'],
  ['Pathology & lab services', 'Services de pathologie et de laboratoire'],
  ['Histology, immunohistochemistry (IHC), cytology, and molecular testing with clear pricing and secure, timely reporting.', 'Histologie, immunohistochimie (IHC), cytologie et biologie moleculaire avec des prix clairs et un rendu securise dans les delais.'],
  ['Prices', 'Prix'],
  ['Current tests and prices. Contact the lab for package deals or bulk pricing.', 'Analyses et tarifs actuels. Contactez le laboratoire pour les forfaits ou les tarifs de volume.'],
  ['Ready to get started?', 'Pret a commencer ?'],
  ['Staff: sign in to manage orders. Patients: use the patient portal to check your results securely.', 'Personnel : connectez-vous pour gerer les commandes. Patients : utilisez le portail patient pour consulter vos resultats en toute securite.'],
  ['Sign in to LIMS', 'Se connecter au LIMS'],
  ['Sign in', 'Se connecter'],
  ['Laboratory Information Management System', "Systeme de gestion des informations de laboratoire"],
  ['Use your seeded staff credentials to access the correct role dashboard.', 'Utilisez vos identifiants precharges pour acceder au tableau de bord correspondant a votre role.'],
  ['Patient? Look up your test results', 'Patient ? Consultez vos resultats'],
  ['Staff can manage orders, workflows, reports, inventory, and referrals from a single secure portal.', 'Le personnel peut gerer les commandes, workflows, rapports, inventaire et referrals depuis un portail securise unique.'],
  ['What We Offer', 'Nos services'],
  ['Transparent Pricing', 'Tarification transparente'],
  ['Who We Are', 'Qui sommes-nous'],
  ['Find my orders', 'Retrouver mes commandes'],
  ['Request test online', 'Demander une analyse en ligne'],
  ['Log in to Patient portal to track order', 'Se connecter au portail patient pour suivre la commande'],
  ['Look up different person', 'Rechercher une autre personne'],
  ['Back to my orders', 'Retour a mes commandes'],
  ['Back to inventory', "Retour a l'inventaire"],
  ['Sync from accessions', 'Synchroniser depuis les accessions'],
  ['Find your pathology orders', 'Retrouvez vos commandes de pathologie'],
  ['Use your last name and date of birth to see current and past orders, payment status, courier progress, and final results.', 'Utilisez votre nom de famille et votre date de naissance pour voir vos commandes actuelles et passees, le statut de paiement, lavancement du coursier et les resultats finaux.'],
  ['Your orders', 'Vos commandes'],
  ['All your tests with X.PATH Labs through OLYVIA. Click an order for details, timeline, results, and payment.', 'Toutes vos analyses chez X.PATH Labs via OLYVIA. Cliquez sur une commande pour voir les details, le suivi, les resultats et le paiement.'],
  ['Verify your identity', 'Verifiez votre identite'],
  ['Enter the same last name and date of birth used on the order before viewing the result, payment, and courier details.', 'Saisissez le meme nom de famille et la meme date de naissance que sur la commande avant de consulter les resultats, le paiement et les details du coursier.'],
  ['Order details and tracking', 'Details et suivi de la commande'],
  ['Follow each step from intake through reporting, including courier movement and payment progress.', 'Suivez chaque etape depuis la reception jusquau rapport final, y compris le parcours du coursier et la progression du paiement.'],
  ['Results', 'Resultats'],
  ['Request payment confirmation', 'Demander une confirmation de paiement'],
  ['Support', 'Support'],
  ['Loading module audit…', "Chargement de l'audit des modules…"],
  ['Loading audit trail…', "Chargement de la piste d'audit…"],
  ['Loading sessions…', 'Chargement des sessions…'],
  ['Loading credential audit…', "Chargement de l'audit des identifiants…"],
  ['Loading settings…', 'Chargement des parametres…'],
  ['Loading dashboard…', 'Chargement du tableau de bord…'],
  ['Loading finance…', 'Chargement des finances…'],
  ['Loading sample…', "Chargement de l'echantillon…"],
  ['Loading referrer portal…', 'Chargement du portail referent…'],
  ['Loading public site…', 'Chargement du site public…'],
  ['Loading order form…', 'Chargement du formulaire de commande…'],
  ['Loading order…', 'Chargement de la commande…'],
  ['Loading order details…', 'Chargement des details de la commande…'],
  ['Checking access…', "Verification de l'acces…"],
  ['Restoring session…', 'Restauration de la session…'],
  ['Loading…', 'Chargement…'],
  ['Save changes', 'Enregistrer les modifications'],
  ['Save password', 'Enregistrer le mot de passe'],
  ['Save', 'Enregistrer'],
  ['Cancel', 'Annuler'],
  ['Edit', 'Modifier'],
  ['Delete', 'Supprimer'],
  ['Activate', 'Activer'],
  ['Deactivate', 'Desactiver'],
  ['Actions', 'Actions'],
  ['Name', 'Nom'],
  ['Email', 'E-mail'],
  ['Role', 'Role'],
  ['Site', 'Site'],
  ['Active', 'Actif'],
  ['Password', 'Mot de passe'],
  ['Code', 'Code'],
  ['Type', 'Type'],
  ['Contact', 'Contact'],
  ['Portal user', 'Utilisateur du portail'],
  ['None', 'Aucun'],
  ['Price', 'Prix'],
  ['Patient price', 'Prix patient'],
  ['Insurer price', 'Prix assureur'],
  ['Sample', 'Echantillon'],
  ['Sample type', "Type d'echantillon"],
  ['Patient prices are stored in FCFA and shown with USD, EUR, and legacy French franc equivalents. Only active test types appear on public order screens.', "Les prix patient sont stockes en FCFA et affiches avec leurs equivalents USD, EUR et franc francais historique. Seuls les types d'analyses actifs apparaissent sur les ecrans de commande publics."],
  ['Patient price (FCFA)', 'Prix patient (FCFA)'],
  ['Insurer price (FCFA)', 'Prix assureur (FCFA)'],
  ['Price note', 'Note de prix'],
  ['Category', 'Categorie'],
  ['Current password', 'Mot de passe actuel'],
  ['New password', 'Nouveau mot de passe'],
  ['Confirm new password', 'Confirmer le nouveau mot de passe'],
  ['Profile updated.', 'Profil mis a jour.'],
  ['Password updated.', 'Mot de passe mis a jour.'],
  ['User created successfully.', 'Utilisateur cree avec succes.'],
  ['User updated successfully.', 'Utilisateur mis a jour avec succes.'],
  ['Order request submitted successfully', 'Demande de commande envoyee avec succes'],
  ['Authentication required', 'Authentification requise'],
  ['Invalid email or password', 'E-mail ou mot de passe invalide'],
]

const regexReplacements: Array<[RegExp, string | ((...args: string[]) => string)]> = [
  [/^Create (.+)$/i, (_match, value: string) => `Creer ${value.toLowerCase()}`],
  [/^Edit (.+)$/i, (_match, value: string) => `Modifier ${value.toLowerCase()}`],
  [/^Add (.+)$/i, (_match, value: string) => `Ajouter ${value.toLowerCase()}`],
  [/^Delete (.+)$/i, (_match, value: string) => `Supprimer ${value}`],
  [/^Activate (.+)$/i, (_match, value: string) => `Activer ${value}`],
  [/^Deactivate (.+)$/i, (_match, value: string) => `Desactiver ${value}`],
  [/^Loading (.+?)(?:\.\.\.|…)?$/i, (_match, value: string) => `Chargement ${value.toLowerCase()}…`],
  [/^No (.+) yet\.$/i, (_match, value: string) => `Aucun ${value.toLowerCase()} pour le moment.`],
]

const wordPairs: Array<[string, string]> = [
  ['Yes', 'Oui'],
  ['No', 'Non'],
  ['Created', 'Cree'],
  ['Updated', 'Mis a jour'],
  ['Completed', 'Termine'],
  ['Pending', 'En attente'],
  ['Released', 'Publie'],
  ['Cancelled', 'Annule'],
  ['Received', 'Recu'],
  ['Review', 'Revision'],
  ['urgent', 'urgent'],
  ['normal', 'normal'],
  ['doctor', 'medecin'],
  ['clinic', 'clinique'],
  ['patient', 'patient'],
  ['patients', 'patients'],
  ['order', 'commande'],
  ['orders', 'commandes'],
  ['payment', 'paiement'],
  ['payments', 'paiements'],
  ['report', 'rapport'],
  ['reports', 'rapports'],
  ['inventory', 'inventaire'],
  ['workflow', 'workflow'],
  ['workflows', 'workflows'],
  ['notification', 'notification'],
  ['notifications', 'notifications'],
  ['queue', "file d'attente"],
  ['clearance', 'validation'],
  ['pickup', 'collecte'],
  ['transit', 'transit'],
  ['processing', 'traitement'],
  ['pathologist', 'pathologiste'],
  ['technician', 'technicien'],
  ['receptionist', 'receptionniste'],
  ['finance', 'finance'],
  ['courier', 'coursier'],
  ['super admin', 'super administrateur'],
  ['admin', 'administrateur'],
  ['sample', 'echantillon'],
  ['samples', 'echantillons'],
  ['slide', 'lame'],
  ['slides', 'lames'],
  ['block', 'bloc'],
  ['blocks', 'blocs'],
  ['accession', 'accession'],
  ['history', 'historique'],
  ['status', 'statut'],
  ['priority', 'priorite'],
  ['timeline', 'chronologie'],
  ['support', 'support'],
  ['public', 'public'],
  ['contact', 'contact'],
  ['settings', 'parametres'],
  ['language', 'langue'],
  ['timezone', 'fuseau horaire'],
  ['currency', 'devise'],
  ['about', 'a propos'],
  ['revenue', 'revenu'],
  ['method', 'methode'],
  ['profile', 'profil'],
  ['referral', 'reference'],
  ['linked', 'lie'],
  ['final', 'final'],
]

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function applyCase(source: string, target: string) {
  if (source.toUpperCase() === source) {
    return target.toUpperCase()
  }
  if (source[0] && source[0] === source[0].toUpperCase()) {
    return target[0]?.toUpperCase() + target.slice(1)
  }
  return target
}

function readStoredLocale(): AppLocale {
  if (typeof window === 'undefined') {
    return 'fr'
  }
  const stored = window.localStorage.getItem(storageKeys.locale)
  return stored === 'en' || stored === 'fr' ? stored : 'fr'
}

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

export function translateTextForLocale(text: string, locale: AppLocale) {
  if (!text || locale === 'en') {
    return text
  }

  const normalized = normalizeWhitespace(text)
  if (!normalized) {
    return text
  }

  let translated = text

  for (const [english, french] of exactPhrasePairs.sort((a, b) => b[0].length - a[0].length)) {
    const pattern = new RegExp(escapeRegExp(english), 'g')
    translated = translated.replace(pattern, french)
  }

  for (const [pattern, replacement] of regexReplacements) {
    translated = translated.replace(pattern, replacement as never)
  }

  for (const [english, french] of wordPairs) {
    const pattern = new RegExp(`\\b${escapeRegExp(english)}\\b`, 'gi')
    translated = translated.replace(pattern, (match) => applyCase(match, french))
  }

  translated = translated
    .replace(/Create user management/g, 'Creer la gestion des utilisateurs')
    .replace(/Create doctor \/ clinic/g, 'Ajouter un medecin / une clinique')
    .replace(/Create test type/g, "Creer un type d'analyse")
    .replace(/Create order/g, 'Creer une commande')
    .replace(/Edit order/g, 'Modifier la commande')
    .replace(/Edit case/g, 'Modifier le cas')
    .replace(/Add vendor connector/g, 'Ajouter un connecteur fournisseur')
    .replace(/Edit vendor connector/g, 'Modifier le connecteur fournisseur')

  return translated
}

export function LanguageProvider({ children }: PropsWithChildren) {
  const { user, setUser } = useAuth()
  const [locale, setLocaleState] = useState<AppLocale>(() => readStoredLocale())
  const titleOriginalRef = useRef<string>('')
  const textOriginalsRef = useRef(new WeakMap<Text, string>())
  const attributeOriginalsRef = useRef(new WeakMap<HTMLElement, Map<string, string>>())
  const applyingRef = useRef(false)
  const lastUserIdRef = useRef<string | null>(null)

  const writeLocale = useCallback((nextLocale: AppLocale) => {
    setLocaleState(nextLocale)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(storageKeys.locale, nextLocale)
    }
  }, [])

  const setLocale = useCallback(
    (nextLocale: AppLocale, options?: { persistPreference?: boolean }) => {
      writeLocale(nextLocale)

      if (options?.persistPreference === false || !user) {
        return
      }

      const preferredLanguage = nextLocale === 'fr' ? 'french' : 'english'
      setUser({
        ...user,
        preferredLocale: nextLocale,
        preferredLanguage,
      })
      void api.put('/users/me', {
        preferredLocale: nextLocale,
        preferredLanguage,
      })
    },
    [setUser, user, writeLocale],
  )

  const translate = useCallback(
    (text: string) => translateTextForLocale(text, locale),
    [locale],
  )

  useEffect(() => {
    if (!user) {
      lastUserIdRef.current = null
      return
    }

    if (lastUserIdRef.current !== user._id) {
      lastUserIdRef.current = user._id
      writeLocale(user.preferredLocale ?? 'fr')
    }
  }, [user, writeLocale])

  const shouldSkipTextTranslation = (element: HTMLElement | null) => {
    if (!element) {
      return true
    }
    if (element.closest('[data-no-translate="true"]')) {
      return true
    }
    if (element.isContentEditable) {
      return true
    }
    return ['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA', 'INPUT'].includes(
      element.tagName,
    )
  }

  const translateAttributes = useCallback(
    (element: HTMLElement) => {
      if (element.closest('[data-no-translate="true"]')) {
        return
      }

      const attributes = ['placeholder', 'title', 'aria-label']
      if (
        element instanceof HTMLInputElement &&
        ['button', 'submit', 'reset'].includes(element.type)
      ) {
        attributes.push('value')
      }

      let originals = attributeOriginalsRef.current.get(element)
      if (!originals) {
        originals = new Map<string, string>()
        attributeOriginalsRef.current.set(element, originals)
      }

      for (const attribute of attributes) {
        const value = element.getAttribute(attribute)
        if (value === null) {
          continue
        }
        if (!originals.has(attribute)) {
          originals.set(attribute, value)
        }
        const source = originals.get(attribute) ?? value
        const translated = locale === 'fr' ? translateTextForLocale(source, locale) : source
        if (element.getAttribute(attribute) !== translated) {
          element.setAttribute(attribute, translated)
        }
      }
    },
    [locale],
  )

  const translateNode = useCallback(
    (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const textNode = node as Text
        const parent = textNode.parentElement
        if (shouldSkipTextTranslation(parent)) {
          return
        }
        const current = textNode.nodeValue ?? ''
        if (!current.trim()) {
          return
        }
        if (!textOriginalsRef.current.has(textNode)) {
          textOriginalsRef.current.set(textNode, current)
        }
        const source = textOriginalsRef.current.get(textNode) ?? current
        const translated = locale === 'fr' ? translateTextForLocale(source, locale) : source
        if (textNode.nodeValue !== translated) {
          textNode.nodeValue = translated
        }
        return
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return
      }

      const element = node as HTMLElement
      translateAttributes(element)
      for (const child of Array.from(element.childNodes)) {
        translateNode(child)
      }
    },
    [locale, translateAttributes],
  )

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    if (!titleOriginalRef.current) {
      titleOriginalRef.current = document.title
    }

    const applyTranslations = (root: Node | null) => {
      if (!root) {
        return
      }
      applyingRef.current = true
      try {
        translateNode(root)
        document.documentElement.lang = locale
        document.title =
          locale === 'fr'
            ? translateTextForLocale(titleOriginalRef.current, locale)
            : titleOriginalRef.current
      } finally {
        applyingRef.current = false
      }
    }

    applyTranslations(document.body)

    const observer = new MutationObserver((mutations) => {
      if (applyingRef.current) {
        return
      }
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          applyTranslations(mutation.target)
          continue
        }
        if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) {
          applyTranslations(mutation.target)
          continue
        }
        for (const node of Array.from(mutation.addedNodes)) {
          applyTranslations(node)
        }
      }
    })

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label', 'value'],
    })

    return () => observer.disconnect()
  }, [locale, translateNode])

  const value = useMemo<LanguageContextValue>(
    () => ({
      locale,
      setLocale,
      toggleLocale: () => setLocale(locale === 'en' ? 'fr' : 'en'),
      translate,
    }),
    [locale, setLocale, translate],
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider')
  }
  return context
}

export function FloatingLanguageToggle() {
  const { locale, setLocale } = useLanguage()

  return (
    <Paper
      data-no-translate="true"
      elevation={0}
      sx={{
        position: 'fixed',
        bottom: 16,
        right: 14,
        zIndex: 1400,
        px: 1,
        py: 0.9,
        borderRadius: 999,
        border: '1px solid rgba(18,42,76,0.14)',
        bgcolor: alpha('#ffffff', 0.9),
        backdropFilter: 'blur(10px)',
        boxShadow: '0 14px 32px rgba(22, 36, 61, 0.12)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <TranslateRoundedIcon sx={{ fontSize: 18, color: 'primary.main' }} />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={locale}
          onChange={(_event, nextLocale: AppLocale | null) => {
            if (nextLocale) {
              setLocale(nextLocale)
            }
          }}
        >
          <ToggleButton value="en">EN</ToggleButton>
          <ToggleButton value="fr">FR</ToggleButton>
        </ToggleButtonGroup>
        <Typography sx={{ fontSize: 11.5, color: 'text.secondary', display: { xs: 'none', md: 'block' } }}>
          {locale === 'fr' ? 'Francais' : 'English'}
        </Typography>
      </Box>
    </Paper>
  )
}
