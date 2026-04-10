import { Navigate, Route, Routes } from 'react-router-dom'

import {
  AnalyticalOperationsPage,
  ClinicalOperationsPage,
  CreateOrderPage,
  CourierPage,
  CytologyCasesPage,
  DashboardPage,
  DigitalPathologyPage,
  DoctorPortalPage,
  DoctorsPage,
  EnterpriseAdminPage,
  FinancePage,
  GovernanceOperationsPage,
  HistologyPage,
  IhcPage,
  InventoryPage,
  LandingPage,
  LoginPage,
  ModuleAuditPage,
  MyAccountPage,
  NotificationsPage,
  OrderDetailPage,
  OrderAuthenticityPage,
  OrderOnlinePage,
  OrdersPage,
  PathologistWorkflowPage,
  PatientOrderDetailPage,
  PatientPortalPage,
  ProjectReviewPage,
  ReceptionistWorkflowPage,
  ReportsPage,
  ResultsQualityPage,
  SampleDetailPage,
  SystemSettingsPage,
  TechnicianWorkflowPage,
  TestTypesPage,
  UsersPage,
  WorkflowHistoryPage,
  WorkflowSelectPage,
  WorkflowTemplatesPage,
} from '../pages'
import { AppIndex } from './AppIndex'
import { ProtectedLayout } from './ProtectedLayout'
import { RoleGuard } from './RoleGuard'

export function AppRoutes() {
  return (
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
        </Route>

        <Route element={<RoleGuard roles={['super_admin', 'admin']} />}>
          <Route path="/operations/clinical" element={<ClinicalOperationsPage />} />
          <Route path="/operations/analytical" element={<AnalyticalOperationsPage />} />
          <Route path="/operations/results-quality" element={<ResultsQualityPage />} />
          <Route path="/operations/governance" element={<GovernanceOperationsPage />} />
          <Route path="/operations/enterprise-admin" element={<EnterpriseAdminPage />} />
          <Route path="/operations/module-audit" element={<ModuleAuditPage />} />
          <Route path="/admin/users" element={<UsersPage />} />
          <Route path="/admin/doctors" element={<DoctorsPage />} />
          <Route path="/admin/test-types" element={<TestTypesPage />} />
          <Route path="/admin/workflow-templates" element={<WorkflowTemplatesPage />} />
          <Route path="/admin/settings" element={<SystemSettingsPage />} />
        </Route>

        <Route element={<RoleGuard roles={['super_admin', 'admin', 'doctor']} />}>
          <Route path="/doctor-portal" element={<DoctorPortalPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
