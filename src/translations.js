// Dictionar plat, scris de mana (fara librarie de i18n) - vezi memoria
// project-i18n-english pentru context complet si conventia de nume
// (<ecran><Actiune> camelCase, o cheie per loc de folosire, niciodata
// partajata intre ecrane diferite chiar daca textul e identic azi).
//
// Regula obligatorie: nicio cheie nu se adauga in JSX fara sa existe deja
// AMBELE intrari (ro + en) aici, in acelasi commit - o cheie prezenta doar
// in ro pare sa mearga (fallback implicit pe ro) dar randeaza gol in
// engleza prima data cand cineva chiar comuta limba.
//
// Pentru string-uri parametrizate, valoarea e o functie: (n) => `text ${n}`.

export const TRANSLATIONS = {
  ro: {
    // NavBar
    navHome: 'Acasă',
    navLog: 'Log',
    navPr: 'PR-uri',
    navLeaderboard: 'Leaderboard',
    navFeed: 'Feed',
    navAdmin: 'Admin',
    navCoach: 'Coach',

    // Acasă
    homeBackToToday: '← Înapoi la azi',
    homeSessionsLabel: 'SESIUNI',
    homeGreeting: (prenume) => `Salut, ${prenume}, hai să dăm bătaie azi.`,
    homeNoClasses: (today) => today ? 'Nicio clasă azi' : 'Nicio clasă în această zi',
    homeClassesAvailable: (n) => n === 1 ? '1 clasă disponibilă' : `${n} clase disponibile`,
    homeReserved: '✓ Rezervat',
    homeWaitlisted: '⏳ Așteptare',
    homeFull: 'Plin',
    homeSpotsLeft: (used, max) => `${used}/${max} locuri`,
    homeDefaultClassName: 'CrossFit WOD',
    homeParticipantsLabel: (cnt, max) => `PARTICIPANȚI (${cnt}/${max})`,
    homeParticipantsCount: (n) => n === 1 ? '1 participant' : `${n} participanți`,
    homeCancelReservation: 'Anulează rezervarea',
    homeWaitlistCancel: '⏳ Pe lista de așteptare · Renunță',
    homeSessionsExhausted: 'Ședințe epuizate',
    homeJoinWaitlist: 'Intră pe lista de așteptare',
    homeBookSpot: 'Rezervă locul',
    homeClassPast: 'Clasă trecută',
    homeWodBadge: 'WORKOUT OF THE DAY',
    homeNoWodToday: 'Niciun WOD azi',
    homeVariantSelected: 'Selectat',
    homeChooseVariantFirst: 'Alege o variantă mai întâi',
    homeLogWithLevel: (nivel) => `Loghează — ${nivel}`,
    homeWodAdminHint: '⚙️ Admin → WOD pentru a crea WOD-ul de azi',
    homeWodMemberHint: 'Coachul nu a programat WOD-ul de azi încă',
    homeDefaultSubscriptionName: 'Abonament',
    homeUnlimited: 'Nelimitat',
    homeDaysLeft: (n) => n === 1 ? '1 zi rămasă' : `${n} zile rămase`,

    // Abonament
    subMyTitle: 'Abonamentul meu',
    subNoActive: 'Niciun abonament activ',
    subContactCoachAdd: 'Contactează coachul pentru a adăuga un abonament.',
    subScheduled: 'Abonament programat',
    subSessionsExhausted: 'Ședințe epuizate',
    subExpired: 'Abonament expirat',
    subStartsOn: (date) => `Începe pe ${date}.`,
    subAllSessionsUsed: 'Ai consumat toate ședințele. Contactează coachul pentru un abonament nou.',
    subContactCoachRenew: 'Contactează coachul pentru reînnoire.',
    subActivePlan: 'Plan activ',
    subActiveBadge: '✓ Activ',
    subValidLabel: 'Valabil',
    subSessionsUsedLabel: 'Ședințe folosite',
    subContactCoachFooter: 'Pentru reînnoire sau întrebări contactează coachul.',
    subMyReservations: 'REZERVĂRILE MELE',
    subUpcoming: 'URMEAZĂ',
    subCancel: 'Anulează',
    subHistory: 'ISTORIC',

    // Paywall (modal blocare fara abonament activ)
    paywallNoSubscription: 'Niciun abonament activ',
    paywallExpired: 'Abonamentul a expirat',
    paywallNoSubscriptionText: 'Nu ai un abonament activ. Contactează coachul pentru a te înscrie.',
    paywallStartsOnText: (date) => `Abonamentul tău începe pe ${date}. Revino atunci!`,
    paywallSessionsExhaustedText: 'Ai consumat toate ședințele din abonament. Contactează coachul pentru a achiziționa un abonament nou.',
    paywallExpiredText: 'Abonamentul tău a expirat. Contactează coachul pentru reînnoire.',
    paywallReload: 'Reîncarcă',
    paywallViewSubscription: 'Vezi abonamentul →',
    paywallLogout: 'Deconectează-te',

    // Calendar picker
    calPickerGoToToday: 'Mergi la azi',

    // Profil - comutator de limba
    profileLanguageTitle: 'Limbă',
    profileLanguageSubtitle: 'Limba folosită în toată aplicația.',

    // Ecran incarcare initiala
    authLoadingText: 'Se încarcă...',

    // Reset parola
    resetTitle: 'Parolă nouă',
    resetSubtitle: 'Alege o parolă nouă pentru contul tău',
    resetNewPasswordLabel: 'Parolă nouă',
    resetNewPasswordPlaceholder: 'minimum 6 caractere',
    resetConfirmPasswordLabel: 'Confirmă parola',
    resetConfirmPasswordPlaceholder: 'repetă parola',
    resetSavingButton: 'Se salvează...',
    resetSaveButton: 'Salvează parola',
    resetPasswordMismatch: 'Parolele nu coincid.',
    resetPasswordTooShort: 'Parola trebuie să aibă minim 6 caractere.',

    // Login / Register
    authAppName: 'Forge',
    authWelcomeBack: 'Bine ai revenit!',
    authCreateAccount: 'Creează cont nou',
    authEmailLabel: 'Email',
    authEmailPlaceholder: 'email@exemplu.com',
    authPasswordLabel: 'Parolă',
    authPasswordPlaceholder: 'minimum 6 caractere',
    authRememberMe: 'Ține-mă minte',
    authForgotPassword: 'Ai uitat parola?',
    authLoadingButton: 'Se încarcă...',
    authLoginButton: 'Intră în cont',
    authRegisterButton: 'Creează cont',
    authNoAccount: 'Nu ai cont? ',
    authHasAccount: 'Ai deja cont? ',
    authRegisterLink: 'Înregistrează-te',
    authLoginLink: 'Intră în cont',
    authEnterEmailFirst: 'Introdu emailul mai întâi.',
    authResetEmailSent: '✓ Email de resetare trimis! Verifică inbox-ul.',
    authCheckEmailConfirm: '✓ Verifică emailul pentru confirmare!',

    // Instalare PWA
    installTitle: 'Instalează Forge',
    installSubtitle: 'Adaugă pe ecranul principal',
    installIosStep1Text: 'Apasă butonul',
    installIosStep1Sub: 'Share — în bara de jos a Safari',
    installIosStep2Text: 'Derulează și alege',
    installIosStep2Sub: '"Add to Home Screen"',
    installIosStep3Text: 'Apasă',
    installIosStep3Sub: '"Add" în colțul din dreapta sus',
    installIosHint: 'Butonul Share (⎋) se află în mijlocul barei de jos din Safari',
    installAndroidStep1Text: 'Apasă meniul',
    installAndroidStep1Sub: 'Cele 3 puncte din colțul browserului',
    installAndroidStep2Text: 'Alege opțiunea',
    installAndroidStep2Sub: '"Adaugă pe ecranul principal"',
    installGotIt: 'Am înțeles',
    installAddToHomeScreen: '+ Adaugă pe ecranul principal',

    // Onboarding
    onboardingWelcome: 'Bun venit! 👋',
    onboardingStep1Subtitle: 'Completează datele tale pentru înregistrare.',
    onboardingFirstNameLabel: 'Prenume *',
    onboardingFirstNamePlaceholder: 'ex: Andrei',
    onboardingLastNameLabel: 'Nume *',
    onboardingLastNamePlaceholder: 'ex: Popescu',
    onboardingBirthDateLabel: 'Data nașterii *',
    onboardingContinue: 'Continuă →',
    onboardingFillRequired: '❌ Completează toate câmpurile obligatorii!',
    onboardingGenderTitle: 'Selectează genul',
    onboardingGenderSubtitle: 'Folosit pentru clasamentul pe categorii.',
    onboardingGenderMale: 'Masculin',
    onboardingGenderFemale: 'Feminin',
    onboardingBack: '← Înapoi',
    onboardingSelectGender: '❌ Selectează genul!',
    onboardingWaiverRenewalTitle: (year) => `Reînnoire acord ${year}`,
    onboardingWaiverTitle: 'Acord de participare',
    onboardingWaiverRenewalSubtitle: 'Acordul de participare se reînnoiește anual. Citește și acceptă pentru a continua.',
    onboardingWaiverSubtitle: 'Citește și acceptă acordul pentru a continua.',
    onboardingWaiverHeading: 'DECLARAȚIE DE CONSIMȚĂMÂNT — CrossFit C15 / Forge',
    onboardingWaiver1Title: '1. Starea de sănătate',
    onboardingWaiver1Text: 'Declar că sunt apt/ă din punct de vedere medical pentru activități fizice de intensitate ridicată și nu am contraindicații medicale cunoscute. Am consultat sau mă angajez să consult un medic înainte de începerea programului.',
    onboardingWaiver2Title: '2. Asumarea riscurilor',
    onboardingWaiver2Text: 'Înțeleg că CrossFit și activitățile sportive implică riscuri inerente de accidentare. Îmi asum în mod voluntar aceste riscuri și participarea este de bună voie.',
    onboardingWaiver3Title: '3. Limitarea răspunderii',
    onboardingWaiver3Text: 'CrossFit C15, Forge și antrenorii nu sunt responsabili pentru accidentări, prejudicii sau pierderi survenite în timpul antrenamentelor, cu excepția cazurilor de neglijență gravă dovedită.',
    onboardingWaiver4Title: '4. Regulamentul sălii',
    onboardingWaiver4Text: 'Mă angajez să respect instrucțiunile antrenorilor, regulamentul intern și să utilizez echipamentul în siguranță. Comportamentul neadecvat poate duce la suspendarea accesului.',
    onboardingWaiver5Title: '5. Date personale',
    onboardingWaiver5Text: 'Datele mele personale sunt utilizate exclusiv pentru gestionarea membriei CrossFit C15 și nu vor fi partajate cu terți fără acordul meu explicit.',
    onboardingWaiverCheckbox: 'Am citit, înțeles și sunt de acord cu termenii acordului de mai sus.',
    onboardingConfirm: 'Confirm și intru ✓',
  },
  en: {
    // NavBar
    navHome: 'Home',
    navLog: 'Log',
    navPr: 'PRs',
    navLeaderboard: 'Leaderboard',
    navFeed: 'Feed',
    navAdmin: 'Admin',
    navCoach: 'Coach',

    // Acasă
    homeBackToToday: '← Back to today',
    homeSessionsLabel: 'SESSIONS',
    homeGreeting: (prenume) => `Hey ${prenume}, let's get after it today.`,
    homeNoClasses: (today) => today ? 'No class today' : 'No class on this day',
    homeClassesAvailable: (n) => n === 1 ? '1 class available' : `${n} classes available`,
    homeReserved: '✓ Reserved',
    homeWaitlisted: '⏳ Waitlisted',
    homeFull: 'Full',
    homeSpotsLeft: (used, max) => `${used}/${max} spots`,
    homeDefaultClassName: 'CrossFit WOD',
    homeParticipantsLabel: (cnt, max) => `PARTICIPANTS (${cnt}/${max})`,
    homeParticipantsCount: (n) => n === 1 ? '1 participant' : `${n} participants`,
    homeCancelReservation: 'Cancel reservation',
    homeWaitlistCancel: '⏳ On waitlist · Leave',
    homeSessionsExhausted: 'Sessions used up',
    homeJoinWaitlist: 'Join the waitlist',
    homeBookSpot: 'Book spot',
    homeClassPast: 'Past class',
    homeWodBadge: 'WORKOUT OF THE DAY',
    homeNoWodToday: 'No WOD today',
    homeVariantSelected: 'Selected',
    homeChooseVariantFirst: 'Choose a variant first',
    homeLogWithLevel: (nivel) => `Log — ${nivel}`,
    homeWodAdminHint: '⚙️ Admin → WOD to create today’s WOD',
    homeWodMemberHint: 'The coach hasn’t scheduled today’s WOD yet',
    homeDefaultSubscriptionName: 'Subscription',
    homeUnlimited: 'Unlimited',
    homeDaysLeft: (n) => n === 1 ? '1 day left' : `${n} days left`,

    // Abonament
    subMyTitle: 'My subscription',
    subNoActive: 'No active subscription',
    subContactCoachAdd: 'Contact your coach to add a subscription.',
    subScheduled: 'Subscription scheduled',
    subSessionsExhausted: 'Sessions used up',
    subExpired: 'Subscription expired',
    subStartsOn: (date) => `Starts on ${date}.`,
    subAllSessionsUsed: 'You’ve used all your sessions. Contact your coach for a new subscription.',
    subContactCoachRenew: 'Contact your coach to renew.',
    subActivePlan: 'Active plan',
    subActiveBadge: '✓ Active',
    subValidLabel: 'Valid',
    subSessionsUsedLabel: 'Sessions used',
    subContactCoachFooter: 'For renewal or questions, contact your coach.',
    subMyReservations: 'MY RESERVATIONS',
    subUpcoming: 'UPCOMING',
    subCancel: 'Cancel',
    subHistory: 'HISTORY',

    // Paywall (modal blocare fara abonament activ)
    paywallNoSubscription: 'No active subscription',
    paywallExpired: 'Subscription expired',
    paywallNoSubscriptionText: 'You don’t have an active subscription. Contact your coach to sign up.',
    paywallStartsOnText: (date) => `Your subscription starts on ${date}. Come back then!`,
    paywallSessionsExhaustedText: 'You’ve used all your subscription sessions. Contact your coach to purchase a new subscription.',
    paywallExpiredText: 'Your subscription has expired. Contact your coach to renew.',
    paywallReload: 'Reload',
    paywallViewSubscription: 'View subscription →',
    paywallLogout: 'Sign out',

    // Calendar picker
    calPickerGoToToday: 'Go to today',

    // Profil - comutator de limba
    profileLanguageTitle: 'Language',
    profileLanguageSubtitle: 'Language used throughout the app.',

    // Ecran incarcare initiala
    authLoadingText: 'Loading...',

    // Reset parola
    resetTitle: 'New password',
    resetSubtitle: 'Choose a new password for your account',
    resetNewPasswordLabel: 'New password',
    resetNewPasswordPlaceholder: 'minimum 6 characters',
    resetConfirmPasswordLabel: 'Confirm password',
    resetConfirmPasswordPlaceholder: 'repeat password',
    resetSavingButton: 'Saving...',
    resetSaveButton: 'Save password',
    resetPasswordMismatch: 'Passwords do not match.',
    resetPasswordTooShort: 'Password must be at least 6 characters.',

    // Login / Register
    authAppName: 'Forge',
    authWelcomeBack: 'Welcome back!',
    authCreateAccount: 'Create new account',
    authEmailLabel: 'Email',
    authEmailPlaceholder: 'email@example.com',
    authPasswordLabel: 'Password',
    authPasswordPlaceholder: 'minimum 6 characters',
    authRememberMe: 'Remember me',
    authForgotPassword: 'Forgot password?',
    authLoadingButton: 'Loading...',
    authLoginButton: 'Sign in',
    authRegisterButton: 'Create account',
    authNoAccount: "Don't have an account? ",
    authHasAccount: 'Already have an account? ',
    authRegisterLink: 'Sign up',
    authLoginLink: 'Sign in',
    authEnterEmailFirst: 'Enter your email first.',
    authResetEmailSent: '✓ Reset email sent! Check your inbox.',
    authCheckEmailConfirm: '✓ Check your email to confirm!',

    // Instalare PWA
    installTitle: 'Install Forge',
    installSubtitle: 'Add to home screen',
    installIosStep1Text: 'Tap the button',
    installIosStep1Sub: 'Share — in the bottom bar of Safari',
    installIosStep2Text: 'Scroll down and choose',
    installIosStep2Sub: '"Add to Home Screen"',
    installIosStep3Text: 'Tap',
    installIosStep3Sub: '"Add" in the top-right corner',
    installIosHint: 'The Share button (⎋) is in the middle of the bottom bar in Safari',
    installAndroidStep1Text: 'Tap the menu',
    installAndroidStep1Sub: 'The 3 dots in the corner of the browser',
    installAndroidStep2Text: 'Choose the option',
    installAndroidStep2Sub: '"Add to Home screen"',
    installGotIt: 'Got it',
    installAddToHomeScreen: '+ Add to home screen',

    // Onboarding
    onboardingWelcome: 'Welcome! 👋',
    onboardingStep1Subtitle: 'Fill in your details to register.',
    onboardingFirstNameLabel: 'First name *',
    onboardingFirstNamePlaceholder: 'e.g. Andrew',
    onboardingLastNameLabel: 'Last name *',
    onboardingLastNamePlaceholder: 'e.g. Smith',
    onboardingBirthDateLabel: 'Date of birth *',
    onboardingContinue: 'Continue →',
    onboardingFillRequired: '❌ Fill in all required fields!',
    onboardingGenderTitle: 'Select your gender',
    onboardingGenderSubtitle: 'Used for the category leaderboard.',
    onboardingGenderMale: 'Male',
    onboardingGenderFemale: 'Female',
    onboardingBack: '← Back',
    onboardingSelectGender: '❌ Select your gender!',
    onboardingWaiverRenewalTitle: (year) => `${year} Waiver Renewal`,
    onboardingWaiverTitle: 'Participation Waiver',
    onboardingWaiverRenewalSubtitle: 'The participation waiver renews annually. Read and accept it to continue.',
    onboardingWaiverSubtitle: 'Read and accept the waiver to continue.',
    onboardingWaiverHeading: 'CONSENT STATEMENT — CrossFit C15 / Forge',
    onboardingWaiver1Title: '1. Health status',
    onboardingWaiver1Text: 'I declare that I am medically fit for high-intensity physical activity and have no known medical contraindications. I have consulted, or commit to consulting, a physician before starting the program.',
    onboardingWaiver2Title: '2. Assumption of risk',
    onboardingWaiver2Text: 'I understand that CrossFit and sports activities carry inherent risks of injury. I voluntarily assume these risks and my participation is of my own free will.',
    onboardingWaiver3Title: '3. Limitation of liability',
    onboardingWaiver3Text: 'CrossFit C15, Forge, and its coaches are not liable for injuries, damages, or losses occurring during training, except in cases of proven gross negligence.',
    onboardingWaiver4Title: '4. Gym rules',
    onboardingWaiver4Text: 'I commit to following coaches’ instructions and internal rules, and to using equipment safely. Inappropriate behavior may result in suspension of access.',
    onboardingWaiver5Title: '5. Personal data',
    onboardingWaiver5Text: 'My personal data is used exclusively for managing CrossFit C15 membership and will not be shared with third parties without my explicit consent.',
    onboardingWaiverCheckbox: 'I have read, understood, and agree to the terms of the waiver above.',
    onboardingConfirm: 'Confirm and enter ✓',
  },
}

// Proxy de dev: o cheie lipsa randeaza vizibil "⚠️MISSING:cheie⚠️" (nu undefined,
// care ar disparea tacut din UI fara nicio eroare de build/lint). Doar in dev -
// in productie preferam un blank silentios unei etichete urate vizibile userilor.
const wrapDev = (dict) => {
  if (!import.meta.env.DEV) return dict
  return new Proxy(dict, {
    get(target, key) {
      if (key in target) return target[key]
      console.error(`[i18n] cheie lipsa: "${String(key)}"`)
      return `⚠️MISSING:${String(key)}⚠️`
    },
  })
}

export const T_RO = wrapDev(TRANSLATIONS.ro)
export const T_EN = wrapDev(TRANSLATIONS.en)

export function getT(lang) {
  return lang === 'en' ? T_EN : T_RO
}
