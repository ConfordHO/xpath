import AddRoundedIcon from '@mui/icons-material/AddRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
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
import { useState } from 'react'
import { useAuth } from '../auth'
import { EmptyState, LoadingPanel, PageHeader, SectionCard } from '../components'
import type { Branch, Organization } from '../types'
import { api } from '../api'
import { useLoadable, useActionLock } from './shared'

// ─── Organization Management (super_admin) ────────────────────────────────────

export function OrganizationManagementPage() {
  const { user } = useAuth()
  const actionLock = useActionLock()
  const orgsState = useLoadable<Organization[]>([], [], async () => {
    const res = await api.get<Organization[]>('/platform/organizations')
    return res.data
  })

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({
    slug: '',
    name: '',
    plan: 'standard',
    ownerEmail: '',
    country: 'CM',
    timezone: 'Africa/Douala',
    currency: 'XAF',
    contactPhone: '',
    address: '',
  })
  const [adminName, setAdminName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [labName, setLabName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const provision = async () => {
    setError(null)
    await actionLock.runLocked('provision', async () => {
      try {
        await api.post('/platform/provision', {
          org: draft,
          adminName,
          adminEmail,
          adminPassword,
          labName: labName || draft.name,
        })
        setSuccess(`Organization '${draft.name}' provisioned. Admin: ${adminEmail}`)
        setOpen(false)
        orgsState.refresh()
      } catch (e: unknown) {
        const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message
        setError(msg ?? 'Failed to provision organization')
      }
    })
  }

  if (user?.role !== 'super_admin') {
    return <EmptyState title="Access restricted" body="Only platform super administrators can manage organizations." />
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Organizations"
        description="Manage lab tenants on the OLYVIA platform"
        action={
          <Button startIcon={<AddRoundedIcon />} variant="contained" onClick={() => setOpen(true)}>
            New Organization
          </Button>
        }
      />

      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <SectionCard title="All Organizations">
        {orgsState.loading ? (
          <LoadingPanel label="Loading organizations…" />
        ) : orgsState.data.length === 0 ? (
          <EmptyState title="No organizations yet" body="Provision your first tenant lab above." />
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Slug</TableCell>
                  <TableCell>Plan</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Owner</TableCell>
                  <TableCell>Country</TableCell>
                  <TableCell>Currency</TableCell>
                  <TableCell>Created</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {orgsState.data.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell><strong>{org.name}</strong></TableCell>
                    <TableCell><code>{org.slug}</code></TableCell>
                    <TableCell>{org.plan}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={org.status}
                        color={org.status === 'active' ? 'success' : org.status === 'trial' ? 'warning' : 'error'}
                      />
                    </TableCell>
                    <TableCell>{org.ownerEmail}</TableCell>
                    <TableCell>{org.country}</TableCell>
                    <TableCell>{org.currency}</TableCell>
                    <TableCell>{org.createdAt.slice(0, 10)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </SectionCard>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Provision New Organization</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="subtitle2" color="text.secondary">Organization details</Typography>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' } }}>
              <TextField label="Organization name" value={draft.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} />
              <TextField label="Slug (url-safe, e.g. my-lab)" value={draft.slug} onChange={(e) => setDraft((p) => ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))} />
              <FormControl>
                <InputLabel>Plan</InputLabel>
                <Select label="Plan" value={draft.plan} onChange={(e) => setDraft((p) => ({ ...p, plan: String(e.target.value) }))}>
                  <MenuItem value="trial">Trial</MenuItem>
                  <MenuItem value="starter">Starter</MenuItem>
                  <MenuItem value="standard">Standard</MenuItem>
                  <MenuItem value="enterprise">Enterprise</MenuItem>
                </Select>
              </FormControl>
              <FormControl>
                <InputLabel>Currency</InputLabel>
                <Select label="Currency" value={draft.currency} onChange={(e) => setDraft((p) => ({ ...p, currency: String(e.target.value) }))}>
                  <MenuItem value="XAF">XAF (CFA Franc)</MenuItem>
                  <MenuItem value="USD">USD</MenuItem>
                  <MenuItem value="EUR">EUR</MenuItem>
                </Select>
              </FormControl>
              <TextField label="Owner email" value={draft.ownerEmail} onChange={(e) => setDraft((p) => ({ ...p, ownerEmail: e.target.value }))} />
              <TextField label="Country code (e.g. CM)" value={draft.country} onChange={(e) => setDraft((p) => ({ ...p, country: e.target.value.toUpperCase().slice(0, 2) }))} />
              <TextField label="Timezone" value={draft.timezone} onChange={(e) => setDraft((p) => ({ ...p, timezone: e.target.value }))} />
              <TextField label="Contact phone" value={draft.contactPhone} onChange={(e) => setDraft((p) => ({ ...p, contactPhone: e.target.value }))} />
            </Box>
            <TextField label="Address" value={draft.address} onChange={(e) => setDraft((p) => ({ ...p, address: e.target.value }))} />

            <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 1 }}>Admin user</Typography>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' } }}>
              <TextField label="Admin full name" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
              <TextField label="Admin email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
              <TextField label="Admin password (min 10 chars)" type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
              <TextField label="Lab display name (optional)" value={labName} onChange={(e) => setLabName(e.target.value)} placeholder={draft.name} />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={actionLock.isPending('provision') || !draft.slug || !draft.name || !adminEmail || !adminPassword}
            onClick={provision}
          >
            {actionLock.isPending('provision') ? 'Provisioning…' : 'Provision'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

// ─── My Organization & Branch Management ─────────────────────────────────────

export function MyOrganizationPage() {
  const { user } = useAuth()
  const actionLock = useActionLock()

  const orgState = useLoadable<Organization | null>(null, [], async () => {
    const res = await api.get<Organization>('/my-organization')
    return res.data
  })

  const branchesState = useLoadable<Branch[]>([], [], async () => {
    const res = await api.get<Branch[]>('/branches')
    return res.data
  })

  const [branchOpen, setBranchOpen] = useState(false)
  const [branchDraft, setBranchDraft] = useState({
    code: '',
    name: '',
    address: '',
    phone: '',
    siteType: 'hub',
  })
  const [error, setError] = useState<string | null>(null)

  const createBranch = async () => {
    setError(null)
    await actionLock.runLocked('create-branch', async () => {
      try {
        await api.post('/branches', branchDraft)
        setBranchOpen(false)
        setBranchDraft({ code: '', name: '', address: '', phone: '', siteType: 'hub' })
        branchesState.refresh()
      } catch (e: unknown) {
        const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message
        setError(msg ?? 'Failed to create branch')
      }
    })
  }

  const deactivateBranch = async (id: string) => {
    await actionLock.runLocked(`deactivate-${id}`, async () => {
      await api.delete(`/branches/${id}`)
      branchesState.refresh()
    })
  }

  if (!user || !['admin', 'super_admin'].includes(user.role)) {
    return <EmptyState title="Access restricted" body="Organization management is available to administrators only." />
  }

  const org = orgState.data

  return (
    <Stack spacing={3}>
      <PageHeader
        title="My Organization"
        description="Lab identity and branch locations"
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <SectionCard title="Organization Profile">
        {orgState.loading ? (
          <LoadingPanel label="Loading…" />
        ) : !org ? (
          <EmptyState title="No organization found" body="Contact your platform administrator." />
        ) : (
          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
            {[
              { label: 'Name', value: org.name },
              { label: 'Slug', value: org.slug },
              { label: 'Plan', value: org.plan },
              { label: 'Status', value: org.status },
              { label: 'Currency', value: org.currency },
              { label: 'Country', value: org.country },
              { label: 'Timezone', value: org.timezone },
              { label: 'Owner', value: org.ownerEmail },
              { label: 'Phone', value: org.contactPhone ?? '—' },
            ].map(({ label, value }) => (
              <Box key={label}>
                <Typography variant="caption" color="text.secondary">{label}</Typography>
                <Typography variant="body2" fontWeight={600}>{value}</Typography>
              </Box>
            ))}
            {org.address && (
              <Box sx={{ gridColumn: '1/-1' }}>
                <Typography variant="caption" color="text.secondary">Address</Typography>
                <Typography variant="body2">{org.address}</Typography>
              </Box>
            )}
          </Box>
        )}
      </SectionCard>

      <SectionCard
        title="Branches / Lab Locations"
        description="Each branch is a physical location under this organization"
        action={
          <Button startIcon={<AddRoundedIcon />} variant="outlined" size="small" onClick={() => setBranchOpen(true)}>
            Add Branch
          </Button>
        }
      >
        {branchesState.loading ? (
          <LoadingPanel label="Loading branches…" />
        ) : branchesState.data.length === 0 ? (
          <EmptyState title="No branches yet" body="Add your first lab location above." />
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Code</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Address</TableCell>
                  <TableCell>Phone</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {branchesState.data.map((branch) => (
                  <TableRow key={branch._id}>
                    <TableCell><code>{branch.code}</code></TableCell>
                    <TableCell><strong>{branch.name}</strong></TableCell>
                    <TableCell>{branch.siteType}</TableCell>
                    <TableCell>{branch.address ?? '—'}</TableCell>
                    <TableCell>{branch.phone ?? '—'}</TableCell>
                    <TableCell>
                      <Chip size="small" label={branch.active ? 'Active' : 'Inactive'} color={branch.active ? 'success' : 'default'} />
                    </TableCell>
                    <TableCell>
                      {branch.active && (
                        <Button size="small" color="warning" disabled={actionLock.isPending(`deactivate-${branch._id}`)} onClick={() => deactivateBranch(branch._id)}>
                          Deactivate
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </SectionCard>

      <Dialog open={branchOpen} onClose={() => setBranchOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Branch</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(2, 1fr)' }}>
              <TextField label="Code (e.g. DLA-01)" value={branchDraft.code} onChange={(e) => setBranchDraft((p) => ({ ...p, code: e.target.value }))} />
              <TextField label="Branch name" value={branchDraft.name} onChange={(e) => setBranchDraft((p) => ({ ...p, name: e.target.value }))} />
              <FormControl>
                <InputLabel>Type</InputLabel>
                <Select label="Type" value={branchDraft.siteType} onChange={(e) => setBranchDraft((p) => ({ ...p, siteType: String(e.target.value) }))}>
                  <MenuItem value="hub">Hub (main lab)</MenuItem>
                  <MenuItem value="collection">Collection center</MenuItem>
                  <MenuItem value="spoke">Spoke lab</MenuItem>
                  <MenuItem value="lab">Satellite lab</MenuItem>
                </Select>
              </FormControl>
              <TextField label="Phone" value={branchDraft.phone} onChange={(e) => setBranchDraft((p) => ({ ...p, phone: e.target.value }))} />
            </Box>
            <TextField label="Address" value={branchDraft.address} onChange={(e) => setBranchDraft((p) => ({ ...p, address: e.target.value }))} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBranchOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={actionLock.isPending('create-branch') || !branchDraft.code || !branchDraft.name}
            onClick={createBranch}
          >
            Create Branch
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
