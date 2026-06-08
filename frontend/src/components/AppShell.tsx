import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import MenuRoundedIcon from '@mui/icons-material/MenuRounded'
import {
  AppBar,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Toolbar,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import { useState, type ReactNode } from 'react'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../auth'
import { BrandLogo } from './BrandLogo'
import type { NavGroup } from './nav'

interface AppShellProps {
  groups: NavGroup[]
  children: ReactNode
}

export function AppShell({ groups, children }: AppShellProps) {
  const { user, signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const theme = useTheme()
  const mobile = useMediaQuery(theme.breakpoints.down('lg'))
  const [open, setOpen] = useState(false)

  const drawerContent = (
    <Box
      sx={{
        p: 2,
        height: '100%',
        bgcolor: '#f5f7fa',
      }}
    >
      <Paper
        sx={{
          p: 2,
          mb: 2,
          borderRadius: 3,
          bgcolor: 'rgba(255,255,255,0.94)',
        }}
      >
        <BrandLogo sx={{ width: 210 }} />
        <Typography variant="h6" sx={{ mt: 1, lineHeight: 1 }}>
          OLYVIA
        </Typography>
      </Paper>
      <Paper sx={{ p: 2, mb: 2, bgcolor: 'primary.main', color: 'primary.contrastText' }}>
        <Typography variant="body2" sx={{ opacity: 0.74, letterSpacing: '0.08em' }}>
          SECURE WORKSPACE
        </Typography>
        <Typography variant="h6" sx={{ mt: 0.75 }}>
          {user?.name}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.86 }}>
          {user?.role}
        </Typography>
      </Paper>
      <Paper sx={{ p: 1.5, height: 'calc(100% - 178px)', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ overflowY: 'auto', flex: 1, pr: 0.5 }}>
          {groups.map((group) => (
            <Box key={group.label ?? group.items[0]?.label} sx={{ mb: 1.5 }}>
              {group.label ? (
                <Typography
                  variant="overline"
                  sx={{ px: 1.5, color: 'text.secondary', letterSpacing: '0.1em' }}
                >
                  {group.label}
                </Typography>
              ) : null}
              <List dense sx={{ mt: 0.5 }}>
                {group.items.map((item) => {
                  const active =
                    location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
                  return (
                    <ListItemButton
                      key={item.to}
                      component={RouterLink}
                      to={item.to}
                      onClick={() => setOpen(false)}
                      sx={{
                        borderRadius: 2.5,
                        mb: 0.5,
                        bgcolor: active ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
                        color: active ? 'primary.dark' : 'text.primary',
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 38, color: 'inherit' }}>{item.icon}</ListItemIcon>
                      <ListItemText primary={item.label} />
                    </ListItemButton>
                  )
                })}
              </List>
            </Box>
          ))}
        </Box>
        <Divider sx={{ my: 1 }} />
        <Button
          startIcon={<LogoutRoundedIcon />}
          variant="text"
          color="inherit"
          onClick={() => {
            signOut()
            navigate('/login')
          }}
        >
          Sign out
        </Button>
      </Paper>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {mobile ? (
        <AppBar
          position="fixed"
          color="transparent"
          elevation={0}
          sx={{
            backdropFilter: 'blur(12px)',
            bgcolor: 'rgba(245,247,250,0.86)',
          }}
        >
          <Toolbar sx={{ gap: 1.5 }}>
            <IconButton onClick={() => setOpen(true)}>
              <MenuRoundedIcon />
            </IconButton>
            <Stack
              direction="row"
              alignItems="center"
              sx={{
                px: 1.25,
                py: 0.75,
                borderRadius: 2.5,
                bgcolor: 'rgba(255,255,255,0.94)',
              }}
            >
              <BrandLogo sx={{ width: 136 }} />
              <Typography variant="subtitle1" sx={{ ml: 1, fontWeight: 700 }}>
                OLYVIA
              </Typography>
            </Stack>
          </Toolbar>
        </AppBar>
      ) : null}
      <Drawer
        open={mobile ? open : true}
        onClose={() => setOpen(false)}
        variant={mobile ? 'temporary' : 'permanent'}
        PaperProps={{
          sx: {
            width: 300,
            border: 'none',
            bgcolor: 'background.default',
          },
        }}
      >
        {drawerContent}
      </Drawer>
      <Box component="main" sx={{ flex: 1, ml: { lg: '300px' }, p: { xs: 2, md: 3 }, pt: { xs: 10, lg: 3 } }}>
        {children}
      </Box>
    </Box>
  )
}
