import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import {
  IconButton,
  InputAdornment,
  TextField,
  Tooltip,
  type TextFieldProps,
} from '@mui/material'
import { useState } from 'react'

type PasswordFieldProps = Omit<TextFieldProps, 'type'> & {
  defaultVisible?: boolean
}

export function PasswordField({
  defaultVisible = true,
  InputProps,
  ...props
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(defaultVisible)
  const toggleLabel = visible ? 'Hide password' : 'Show password'

  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      InputProps={{
        ...InputProps,
        endAdornment: (
          <>
            {InputProps?.endAdornment}
            <InputAdornment position="end">
              <Tooltip title={toggleLabel}>
                <IconButton
                  aria-label={toggleLabel}
                  edge="end"
                  onClick={() => setVisible((current) => !current)}
                  onMouseDown={(event) => event.preventDefault()}
                >
                  {visible ? <VisibilityOffRoundedIcon /> : <VisibilityRoundedIcon />}
                </IconButton>
              </Tooltip>
            </InputAdornment>
          </>
        ),
      }}
    />
  )
}
