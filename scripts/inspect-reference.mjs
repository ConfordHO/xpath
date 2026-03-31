const target = 'https://xpath-web-version.vercel.app'

async function main() {
  const response = await fetch(target)
  const html = await response.text()
  const title = html.match(/<title>(.*?)<\/title>/i)?.[1] ?? 'Unknown'
  console.log(`Reference target: ${target}`)
  console.log(`Title: ${title}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
