import AccountCircleOutlinedIcon from '@mui/icons-material/AccountCircleOutlined'
import AddCircleOutlineRoundedIcon from '@mui/icons-material/AddCircleOutlineRounded'
import BiotechOutlinedIcon from '@mui/icons-material/BiotechOutlined'
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded'
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import FolderCopyOutlinedIcon from '@mui/icons-material/FolderCopyOutlined'
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import ListAltOutlinedIcon from '@mui/icons-material/ListAltOutlined'
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined'
import MedicalInformationOutlinedIcon from '@mui/icons-material/MedicalInformationOutlined'
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined'
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined'
import RateReviewOutlinedIcon from '@mui/icons-material/RateReviewOutlined'
import SettingsSuggestOutlinedIcon from '@mui/icons-material/SettingsSuggestOutlined'
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined'
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined'
import VerifiedUserOutlinedIcon from '@mui/icons-material/VerifiedUserOutlined'
import ViewInArOutlinedIcon from '@mui/icons-material/ViewInArOutlined'
import WorkspacesOutlinedIcon from '@mui/icons-material/WorkspacesOutlined'

import type { NavGroup } from '../components'
import type { SafeUser } from '../types'

function settingsGroup(): NavGroup {
  return {
    label: 'Account',
    items: [
      { label: 'Project review', to: '/project-review', icon: <RateReviewOutlinedIcon /> },
      { label: 'Settings', to: '/settings', icon: <AccountCircleOutlinedIcon /> },
    ],
  }
}

export function getNavGroups(user: SafeUser): NavGroup[] {
  switch (user.role) {
    case 'super_admin':
      return [
        {
          items: [
            { label: 'Dashboard', to: '/dashboard', icon: <DashboardOutlinedIcon /> },
            { label: 'Orders', to: '/orders', icon: <ListAltOutlinedIcon /> },
            { label: 'Create order', to: '/orders/create', icon: <AddCircleOutlineRoundedIcon /> },
            { label: 'Financial', to: '/financial', icon: <PaymentsOutlinedIcon /> },
            { label: 'Accounting', to: '/accounting', icon: <PaymentsOutlinedIcon /> },
            { label: 'Courier', to: '/courier', icon: <LocalShippingOutlinedIcon /> },
            { label: 'Receptionist workflow', to: '/receptionist/workflow', icon: <VerifiedUserOutlinedIcon /> },
            { label: 'Technician workflow', to: '/technician/workflow', icon: <ScienceOutlinedIcon /> },
            { label: 'Pathologist workflow', to: '/pathologist/workflow', icon: <DescriptionOutlinedIcon /> },
            { label: 'Reports', to: '/reports', icon: <DescriptionOutlinedIcon /> },
            { label: 'Histology', to: '/histology', icon: <BiotechOutlinedIcon /> },
            { label: 'IHC', to: '/ihc', icon: <BiotechOutlinedIcon /> },
            { label: 'Cytology', to: '/cytology/cases', icon: <MedicalInformationOutlinedIcon /> },
            { label: 'Digital pathology', to: '/digital-pathology', icon: <ViewInArOutlinedIcon /> },
            { label: 'Inventory', to: '/inventory', icon: <Inventory2OutlinedIcon /> },
            { label: 'Workflows', to: '/workflow/select', icon: <WorkspacesOutlinedIcon /> },
            { label: 'Communications', to: '/communications', icon: <ChatBubbleOutlineRoundedIcon /> },
            { label: 'Notifications', to: '/notifications', icon: <NotificationsNoneOutlinedIcon /> },
          ],
        },
        {
          label: 'Administration',
          items: [
            { label: 'Users', to: '/admin/users', icon: <GroupOutlinedIcon /> },
            { label: 'Doctors & referrers', to: '/admin/doctors', icon: <MedicalInformationOutlinedIcon /> },
            { label: 'Test types', to: '/admin/test-types', icon: <TuneOutlinedIcon /> },
            { label: 'Workflow templates', to: '/admin/workflow-templates', icon: <FolderCopyOutlinedIcon /> },
            { label: 'System settings', to: '/admin/settings', icon: <SettingsSuggestOutlinedIcon /> },
            { label: 'Doctor portal', to: '/doctor-portal', icon: <MedicalInformationOutlinedIcon /> },
          ],
        },
        {
          label: 'Enterprise',
          items: [
            { label: 'Clinical operations', to: '/operations/clinical', icon: <VerifiedUserOutlinedIcon /> },
            { label: 'Analytical modules', to: '/operations/analytical', icon: <ScienceOutlinedIcon /> },
            { label: 'Results & quality', to: '/operations/results-quality', icon: <DescriptionOutlinedIcon /> },
            { label: 'Governance & compliance', to: '/operations/governance', icon: <SettingsSuggestOutlinedIcon /> },
            { label: 'Enterprise admin', to: '/operations/enterprise-admin', icon: <TuneOutlinedIcon /> },
            { label: 'Module audit', to: '/operations/module-audit', icon: <FolderCopyOutlinedIcon /> },
            { label: 'Production readiness', to: '/operations/production-hardening', icon: <SettingsSuggestOutlinedIcon /> },
          ],
        },
        settingsGroup(),
      ]
    case 'admin':
      return [
        {
          items: [
            { label: 'Dashboard', to: '/dashboard', icon: <DashboardOutlinedIcon /> },
            { label: 'Orders', to: '/orders', icon: <ListAltOutlinedIcon /> },
            { label: 'Create order', to: '/orders/create', icon: <AddCircleOutlineRoundedIcon /> },
            { label: 'Financial', to: '/financial', icon: <PaymentsOutlinedIcon /> },
            { label: 'Accounting', to: '/accounting', icon: <PaymentsOutlinedIcon /> },
            { label: 'Courier', to: '/courier', icon: <LocalShippingOutlinedIcon /> },
            { label: 'Receptionist workflow', to: '/receptionist/workflow', icon: <VerifiedUserOutlinedIcon /> },
            { label: 'Technician workflow', to: '/technician/workflow', icon: <ScienceOutlinedIcon /> },
            { label: 'Pathologist workflow', to: '/pathologist/workflow', icon: <DescriptionOutlinedIcon /> },
            { label: 'Reports', to: '/reports', icon: <DescriptionOutlinedIcon /> },
            { label: 'Histology', to: '/histology', icon: <BiotechOutlinedIcon /> },
            { label: 'IHC', to: '/ihc', icon: <BiotechOutlinedIcon /> },
            { label: 'Cytology', to: '/cytology/cases', icon: <MedicalInformationOutlinedIcon /> },
            { label: 'Digital pathology', to: '/digital-pathology', icon: <ViewInArOutlinedIcon /> },
            { label: 'Inventory', to: '/inventory', icon: <Inventory2OutlinedIcon /> },
            { label: 'Workflows', to: '/workflow/select', icon: <WorkspacesOutlinedIcon /> },
            { label: 'Communications', to: '/communications', icon: <ChatBubbleOutlineRoundedIcon /> },
            { label: 'Notifications', to: '/notifications', icon: <NotificationsNoneOutlinedIcon /> },
          ],
        },
        {
          label: 'Administration',
          items: [
            { label: 'Users', to: '/admin/users', icon: <GroupOutlinedIcon /> },
            { label: 'Doctors & referrers', to: '/admin/doctors', icon: <MedicalInformationOutlinedIcon /> },
            { label: 'Test types', to: '/admin/test-types', icon: <TuneOutlinedIcon /> },
            { label: 'Workflow templates', to: '/admin/workflow-templates', icon: <FolderCopyOutlinedIcon /> },
            { label: 'System settings', to: '/admin/settings', icon: <SettingsSuggestOutlinedIcon /> },
          ],
        },
        {
          label: 'Enterprise',
          items: [
            { label: 'Clinical operations', to: '/operations/clinical', icon: <VerifiedUserOutlinedIcon /> },
            { label: 'Analytical modules', to: '/operations/analytical', icon: <ScienceOutlinedIcon /> },
            { label: 'Results & quality', to: '/operations/results-quality', icon: <DescriptionOutlinedIcon /> },
            { label: 'Governance & compliance', to: '/operations/governance', icon: <SettingsSuggestOutlinedIcon /> },
            { label: 'Enterprise admin', to: '/operations/enterprise-admin', icon: <TuneOutlinedIcon /> },
            { label: 'Module audit', to: '/operations/module-audit', icon: <FolderCopyOutlinedIcon /> },
            { label: 'Production readiness', to: '/operations/production-hardening', icon: <SettingsSuggestOutlinedIcon /> },
          ],
        },
        settingsGroup(),
      ]
    case 'receptionist':
      return [
        {
          items: [
            { label: 'Dashboard', to: '/dashboard', icon: <DashboardOutlinedIcon /> },
            { label: 'Orders', to: '/orders', icon: <ListAltOutlinedIcon /> },
            { label: 'Create order', to: '/orders/create', icon: <AddCircleOutlineRoundedIcon /> },
            { label: 'Receptionist workflow', to: '/receptionist/workflow', icon: <VerifiedUserOutlinedIcon /> },
            { label: 'Courier', to: '/courier', icon: <LocalShippingOutlinedIcon /> },
            { label: 'Communications', to: '/communications', icon: <ChatBubbleOutlineRoundedIcon /> },
            { label: 'Notifications', to: '/notifications', icon: <NotificationsNoneOutlinedIcon /> },
          ],
        },
        settingsGroup(),
      ]
    case 'technician':
      return [
        {
          items: [
            { label: 'Dashboard', to: '/dashboard', icon: <DashboardOutlinedIcon /> },
            { label: 'Technician workflow', to: '/technician/workflow', icon: <ScienceOutlinedIcon /> },
            { label: 'Histology', to: '/histology', icon: <BiotechOutlinedIcon /> },
            { label: 'IHC', to: '/ihc', icon: <BiotechOutlinedIcon /> },
            { label: 'Cytology', to: '/cytology/cases', icon: <MedicalInformationOutlinedIcon /> },
            { label: 'Digital pathology', to: '/digital-pathology', icon: <ViewInArOutlinedIcon /> },
            { label: 'Inventory', to: '/inventory', icon: <Inventory2OutlinedIcon /> },
            { label: 'Workflows', to: '/workflow/select', icon: <WorkspacesOutlinedIcon /> },
            { label: 'Communications', to: '/communications', icon: <ChatBubbleOutlineRoundedIcon /> },
          ],
        },
        settingsGroup(),
      ]
    case 'pathologist':
      return [
        {
          items: [
            { label: 'Dashboard', to: '/dashboard', icon: <DashboardOutlinedIcon /> },
            { label: 'Pathologist workflow', to: '/pathologist/workflow', icon: <DescriptionOutlinedIcon /> },
            { label: 'Reports', to: '/reports', icon: <DescriptionOutlinedIcon /> },
            { label: 'Cytology', to: '/cytology/cases', icon: <MedicalInformationOutlinedIcon /> },
            { label: 'Digital pathology', to: '/digital-pathology', icon: <ViewInArOutlinedIcon /> },
            { label: 'Communications', to: '/communications', icon: <ChatBubbleOutlineRoundedIcon /> },
            { label: 'Notifications', to: '/notifications', icon: <NotificationsNoneOutlinedIcon /> },
          ],
        },
        settingsGroup(),
      ]
    case 'finance':
      return [
        {
          items: [
            { label: 'Dashboard', to: '/dashboard', icon: <DashboardOutlinedIcon /> },
            { label: 'Financial', to: '/financial', icon: <PaymentsOutlinedIcon /> },
            { label: 'Accounting', to: '/accounting', icon: <PaymentsOutlinedIcon /> },
            { label: 'Communications', to: '/communications', icon: <ChatBubbleOutlineRoundedIcon /> },
            { label: 'Notifications', to: '/notifications', icon: <NotificationsNoneOutlinedIcon /> },
          ],
        },
        settingsGroup(),
      ]
    case 'courier':
      return [
        {
          items: [
            { label: 'Dashboard', to: '/dashboard', icon: <DashboardOutlinedIcon /> },
            { label: 'Courier', to: '/courier', icon: <LocalShippingOutlinedIcon /> },
            { label: 'Communications', to: '/communications', icon: <ChatBubbleOutlineRoundedIcon /> },
            { label: 'Notifications', to: '/notifications', icon: <NotificationsNoneOutlinedIcon /> },
          ],
        },
        settingsGroup(),
      ]
    case 'doctor':
      return [
        {
          items: [
            { label: 'Dashboard', to: '/dashboard', icon: <DashboardOutlinedIcon /> },
            { label: 'Doctor portal', to: '/doctor-portal', icon: <MedicalInformationOutlinedIcon /> },
          ],
        },
        settingsGroup(),
      ]
  }
}
