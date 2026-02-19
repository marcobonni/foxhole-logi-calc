import db from "@/data/foxhole-logi-db.json"

export default function Home() {
  return (
    <main style={{ padding: 20 }}>
      <pre>
        {JSON.stringify(db.rows.slice(0, 10), null, 2)}
      </pre>
    </main>
  )
}