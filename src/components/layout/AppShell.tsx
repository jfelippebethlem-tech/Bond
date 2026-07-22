import Sidebar from './Sidebar'
import CursorGlow from './CursorGlow'

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <CursorGlow />
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto">{children}</main>
    </div>
  )
}
