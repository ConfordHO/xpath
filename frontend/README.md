# X.PATH Frontend

This frontend is a Next.js app. It intentionally does not use Vite.

## Local Development

```bash
npm install
npm run dev
```

Set the API endpoint with:

```bash
NEXT_PUBLIC_API_URL=https://xpath-8pc4.onrender.com/api
```

## Production Build

```bash
npm run build
```

The production output is generated in `.next`, which is what Vercel expects for a Next.js deployment.
