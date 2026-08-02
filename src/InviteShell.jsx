// Shared shell for the two public, unauthenticated invitation-acceptance
// pages (InviteOnboarding.jsx / AcceptAdminInvitation.jsx as of M10.3).
// Its own file, exporting only this one component - same react-refresh
// reasoning as inviteUiKit.js's own comment.
export default function InviteShell({ children }) {
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', background: '#fff' }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ fontSize: '24px', fontWeight: '900', color: '#0E0E0E', letterSpacing: '2px' }}>FORGE</div>
        </div>
        {children}
      </div>
    </div>
  )
}
