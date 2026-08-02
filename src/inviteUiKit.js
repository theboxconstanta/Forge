// Shared style constants for the two public, unauthenticated invitation-
// acceptance pages (InviteOnboarding.jsx / AcceptAdminInvitation.jsx as of
// M10.3). Split out into a plain .js file, not left inline in
// InviteOnboarding.jsx - a file mixing a React component's default export
// with other named exports breaks react-refresh's ability to hot-reload
// the component in isolation (react-refresh/only-export-components),
// caught by lint the moment these were first exported from that file.
export const inputStyle = { width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1.5px solid #e0e0e0', fontSize: '15px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '14px' }
export const buttonStyle = { width: '100%', padding: '14px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' }
export const buttonDisabledStyle = { ...buttonStyle, opacity: 0.6, cursor: 'not-allowed' }
