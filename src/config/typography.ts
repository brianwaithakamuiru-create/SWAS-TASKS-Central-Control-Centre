export const TYPOGRAPHY_SYSTEM = {
  fonts: {
    primary: 'Inter',
    heading: 'Poppins',
    mono: 'JetBrains Mono',
  },
  scale: {
    dashboardHeading: { size: '28px', weight: 600, font: 'Poppins' },
    pageHeading: { size: '24px', weight: 600, font: 'Poppins' },
    sectionHeading: { size: '18px', weight: 600, font: 'Poppins' },
    cardHeading: { size: '16px', weight: 600, font: 'Poppins' },
    navigation: { size: '14px', weight: 500, font: 'Inter' },
    body: { size: '14px', weight: 400, font: 'Inter' },
    table: { size: '13px', weight: 400, font: 'Inter' },
    label: { size: '13px', weight: 500, font: 'Inter' },
    input: { size: '14px', weight: 400, font: 'Inter' },
    button: { size: '14px', weight: 600, font: 'Inter' },
    meta: { size: '12px', weight: 400, font: 'Inter' },
    smallLabel: { size: '11px', weight: 500, font: 'Inter' },
  },
} as const;
