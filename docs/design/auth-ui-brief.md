# Authentication UI Brief

- Status: production UI, persistent default-selection mode.
- Direction: bright, restrained Di Agent workbench; no decorative gradients or oversized glass card.
- Structure: product context on the left, focused authentication flow on the right; single-column below 900px.
- Brand: `Di Agent`, matching the signed-in navigation.
- Hierarchy: product statement → three real capabilities → account title → fields → primary action → route switch.
- Color: warm neutral canvas, white form surface, near-black primary action, blue focus only, semantic red errors.
- Geometry: 8px controls, 1px boundaries, no floating card shadow; 4/8px spacing system.
- Motion: 520–580ms page entrance with 120–220ms control feedback; disabled for reduced-motion users.
- States: hover, focus-visible, disabled/loading, validation error, desktop/tablet/mobile responsive states.
- Gate ledger: Gates 0–7 auto-approved; Gate 8 code/build checks passed but rendered screenshot review is blocked by the in-app browser's failed-page URL policy; Gate 9 remains not fully passed for the same reason.
- Validation: `AuthLayout.test.tsx` passed, TypeScript passed, the Vite production build passed, and `/login` returns HTTP 200. The development server remains available on port 5174 for manual review.
