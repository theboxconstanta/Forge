// Shared shell for public, unauthenticated pages that use this bare
// wordmark-plus-centered-card look: the two invitation-acceptance pages
// (InviteOnboarding.jsx / AcceptAdminInvitation.jsx, M10.3) and the Pricing
// page (M10.4). Its own file, exporting only this one component - same
// react-refresh reasoning as inviteUiKit.js's own comment.
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
