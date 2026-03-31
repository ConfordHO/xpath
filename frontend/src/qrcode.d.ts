declare module 'qrcode' {
  interface ToDataUrlOptions {
    width?: number
    margin?: number
    color?: {
      dark?: string
      light?: string
    }
  }

  const QRCode: {
    toDataURL(text: string, options?: ToDataUrlOptions): Promise<string>
  }

  export default QRCode
}
