import { lazy, Suspense, type ComponentType } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { LoadingPanel } from '../components'
import { LandingPage } from '../views/landing'
import { AppIndex } from './AppIndex'
import { ProtectedLayout } from './ProtectedLayout'
import { RoleGuard } from './RoleGuard'

function lazyPage(loader: () => Promise<unknown>, exportName: string) {
  return lazy(async () => {
    const module = (await loader()) as Record<string, ComponentType>
    return { default: module[exportName] }
  })
}

const DashboardPage = lazyPage(() => import('../views/dashboard'), 'DashboardPage')
const ProjectReviewPage = lazyPage(() => import('../views/projectReview'), 'ProjectReviewPage')
const UsersPage = lazyPage(() => import('../views/admin'), 'UsersPage')
const DoctorsPage = lazyPage(() => import('../views/admin'), 'DoctorsPage')
const TestTypesPage = lazyPage(() => import('../views/admin'), 'TestTypesPage')
const WorkflowTemplatesPage = lazyPage(() => import('../views/admin'), 'WorkflowTemplatesPage')
const SystemSettingsPage = lazyPage(() => import('../views/admin'), 'SystemSettingsPage')
const MyAccountPage = lazyPage(() => import('../views/admin'), 'MyAccountPage')
const DoctorPortalPage = lazyPage(() => import('../views/doctorPortal'), 'DoctorPortalPage')
const FinancePage = lazyPage(() => import('../views/operations'), 'FinancePage')
const AccountingPage = lazyPage(() => import('../views/operations'), 'AccountingPage')
const CourierPage = lazyPage(() => import('../views/operations'), 'CourierPage')
const ReportsPage = lazyPage(() => import('../views/operations'), 'ReportsPage')
const InventoryPage = lazyPage(() => import('../views/operations'), 'InventoryPage')
const SampleDetailPage = lazyPage(() => import('../views/operations'), 'SampleDetailPage')
const NotificationsPage = lazyPage(() => import('../views/operations'), 'NotificationsPage')
const OrdersPage = lazyPage(() => import('../views/orders'), 'OrdersPage')
const CreateOrderPage = lazyPage(() => import('../views/orders'), 'CreateOrderPage')
const OrderDetailPage = lazyPage(() => import('../views/orders'), 'OrderDetailPage')
const CommunicationsPage = lazyPage(() => import('../views/communications'), 'CommunicationsPage')
const CameroonE2EPage = lazyPage(() => import('../views/cameroonE2E'), 'CameroonE2EPage')
const ProductionHardeningPage = lazyPage(() => import('../views/production'), 'ProductionHardeningPage')
const LoginPage = lazyPage(() => import('../views/public'), 'LoginPage')
const PatientPortalPage = lazyPage(() => import('../views/public'), 'PatientPortalPage')
const PatientOrderDetailPage = lazyPage(() => import('../views/public'), 'PatientOrderDetailPage')
const OrderOnlinePage = lazyPage(() => import('../views/order-online'), 'OrderOnlinePage')
const OrderAuthenticityPage = lazyPage(() => import('../views/order-online'), 'OrderAuthenticityPage')
const ClinicalOperationsPage = lazyPage(() => import('../views/enterprise'), 'ClinicalOperationsPage')
const AnalyticalOperationsPage = lazyPage(() => import('../views/enterprise'), 'AnalyticalOperationsPage')
const ResultsQualityPage = lazyPage(() => import('../views/enterprise'), 'ResultsQualityPage')
const GovernanceOperationsPage = lazyPage(() => import('../views/enterprise'), 'GovernanceOperationsPage')
const EnterpriseAdminPage = lazyPage(() => import('../views/enterprise'), 'EnterpriseAdminPage')
const ModuleAuditPage = lazyPage(() => import('../views/enterprise'), 'ModuleAuditPage')
const MyOrganizationPage = lazyPage(() => import('../views/organization'), 'MyOrganizationPage')
const OrganizationManagementPage = lazyPage(() => import('../views/organization'), 'OrganizationManagementPage')
const ReceptionistWorkflowPage = lazyPage(() => import('../views/workflows'), 'ReceptionistWorkflowPage')
const TechnicianWorkflowPage = lazyPage(() => import('../views/workflows'), 'TechnicianWorkflowPage')
const PathologistWorkflowPage = lazyPage(() => import('../views/workflows'), 'PathologistWorkflowPage')
const HistologyPage = lazyPage(() => import('../views/workflows'), 'HistologyPage')
const IhcPage = lazyPage(() => import('../views/workflows'), 'IhcPage')
const CytologyCasesPage = lazyPage(() => import('../views/workflows'), 'CytologyCasesPage')
const DigitalPathologyPage = lazyPage(() => import('../views/workflows'), 'DigitalPathologyPage')
const WorkflowSelectPage = lazyPage(() => import('../views/workflows'), 'WorkflowSelectPage')
const WorkflowHistoryPage = lazyPage(() => import('../views/workflows'), 'WorkflowHistoryPage')

export function AppRoutes() {
  return (
    <Suspense fallback={<LoadingPanel label="Loading…" />}>
      <Routes>
        <Route path="/" element={<AppIndex />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/order-online" element={<OrderOnlinePage />} />
        <Route path="/order-authenticity" element={<OrderAuthenticityPage />} />
        <Route path="/patient-portal" element={<PatientPortalPage />} />
        <Route path="/patient-portal/order/:orderId" element={<PatientOrderDetailPage />} />
        <Route path="/home" element={<LandingPage />} />
        <Route path="/site" element={<LandingPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
          <Route path="/settings" element={<MyAccountPage />} />
          <Route path="/project-review" element={<ProjectReviewPage />} />

          <Route element={<RoleGuard roles={['super_admin', 'admin', 'receptionist', 'technician', 'pathologist']} />}>
            <Route path="/orders" element={<OrdersPage />} />
          </Route>

          <Route element={<RoleGuard roles={['super_admin', 'admin', 'receptionist']} />}>
            <Route path="/orders/create" element={<CreateOrderPage />} />
            <Route path="/receptionist/workflow" element={<ReceptionistWorkflowPage />} />
          </Route>

          <Route element={<RoleGuard roles={['super_admin', 'admin', 'finance']} />}>
            <Route path="/financial" element={<FinancePage />} />
            <Route path="/accounting" element={<AccountingPage />} />
          </Route>

          <Route element={<RoleGuard roles={['super_admin', 'admin', 'receptionist', 'courier']} />}>
            <Route path="/courier" element={<CourierPage />} />
          </Route>

          <Route element={<RoleGuard roles={['super_admin', 'admin', 'technician']} />}>
            <Route path="/technician/workflow" element={<TechnicianWorkflowPage />} />
            <Route path="/histology" element={<HistologyPage />} />
            <Route path="/ihc" element={<IhcPage />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/inventory/sample/:sampleId" element={<SampleDetailPage />} />
            <Route path="/workflow/select" element={<WorkflowSelectPage />} />
            <Route path="/workflow/history" element={<WorkflowHistoryPage />} />
          </Route>

          <Route element={<RoleGuard roles={['super_admin', 'admin', 'pathologist']} />}>
            <Route path="/pathologist/workflow" element={<PathologistWorkflowPage />} />
            <Route path="/reports" element={<ReportsPage />} />
          </Route>

          <Route element={<RoleGuard roles={['super_admin', 'admin', 'technician', 'pathologist']} />}>
            <Route path="/cytology/cases" element={<CytologyCasesPage />} />
            <Route path="/digital-pathology" element={<DigitalPathologyPage />} />
          </Route>

          <Route element={<RoleGuard roles={['super_admin', 'admin', 'receptionist', 'technician', 'pathologist', 'finance', 'courier']} />}>
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/communications" element={<CommunicationsPage />} />
          </Route>

          <Route element={<RoleGuard roles={['super_admin', 'admin']} />}>
            <Route path="/operations/clinical" element={<ClinicalOperationsPage />} />
            <Route path="/operations/analytical" element={<AnalyticalOperationsPage />} />
            <Route path="/operations/results-quality" element={<ResultsQualityPage />} />
            <Route path="/operations/governance" element={<GovernanceOperationsPage />} />
            <Route path="/operations/enterprise-admin" element={<EnterpriseAdminPage />} />
            <Route path="/operations/cameroon-e2e" element={<CameroonE2EPage />} />
            <Route path="/operations/module-audit" element={<ModuleAuditPage />} />
            <Route path="/operations/production-hardening" element={<ProductionHardeningPage />} />
            <Route path="/admin/users" element={<UsersPage />} />
            <Route path="/admin/doctors" element={<DoctorsPage />} />
            <Route path="/admin/test-types" element={<TestTypesPage />} />
            <Route path="/admin/workflow-templates" element={<WorkflowTemplatesPage />} />
            <Route path="/admin/settings" element={<SystemSettingsPage />} />
            <Route path="/admin/organization" element={<MyOrganizationPage />} />
          </Route>

          <Route element={<RoleGuard roles={['super_admin']} />}>
            <Route path="/platform/organizations" element={<OrganizationManagementPage />} />
          </Route>

          <Route element={<RoleGuard roles={['super_admin', 'admin', 'doctor']} />}>
            <Route path="/doctor-portal" element={<DoctorPortalPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
