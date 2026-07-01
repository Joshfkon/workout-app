import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How HyperTrack collects, uses, and protects your data.',
};

// Update this whenever the policy changes.
const LAST_UPDATED = 'June 29, 2026';
const CONTACT_EMAIL = 'privacy@hypertrack.app';

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-surface-950">
      <div className="max-w-3xl mx-auto px-4 py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-200 mb-10 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Home
        </Link>

        <h1 className="text-4xl font-black text-surface-100 mb-2">Privacy Policy</h1>
        <p className="text-surface-400 mb-10">Last updated: {LAST_UPDATED}</p>

        <div className="space-y-10 text-surface-300 leading-relaxed">
          <section className="space-y-3">
            <p>
              HyperTrack (&ldquo;HyperTrack,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or
              &ldquo;our&rdquo;) provides a science-based hypertrophy training app that helps you
              track workouts, nutrition, and body composition. This Privacy Policy explains what
              information we collect, how we use it, who we share it with, and the choices and
              rights you have. It applies to our website and our iOS and Android apps (together, the
              &ldquo;Service&rdquo;).
            </p>
            <p>
              By using the Service, you agree to the collection and use of information in accordance
              with this policy.
            </p>
          </section>

          <Section title="1. Information We Collect">
            <p>We collect the following categories of information:</p>
            <SubHeading>Account information</SubHeading>
            <p>
              When you register, we collect your email address and a securely hashed password.
              Authentication is handled by our infrastructure provider, Supabase.
            </p>

            <SubHeading>Profile &amp; health information</SubHeading>
            <p>
              To personalize your training and nutrition, you may provide health- and
              fitness-related information, including your age, sex, height, body weight, training
              experience, goals, sleep quality, stress levels, injury history, body-composition data
              (such as DEXA scans, FFMI, and body measurements), nutrition and food logs, and
              optional medication information (for example, GLP-1 medications used to tailor protein
              targets). This information is provided by you and used to operate the Service.
            </p>

            <SubHeading>Training &amp; usage data</SubHeading>
            <p>
              We store the workouts, sets, reps, loads, RPE/RIR feedback, rest times, estimated
              one-rep maxes, volume, and related metrics you log, along with app usage needed to
              provide features like progress tracking, plateau detection, and auto-regulation.
            </p>

            <SubHeading>Wearable &amp; health-platform data (optional)</SubHeading>
            <p>
              If you choose to connect a wearable or health platform — such as Fitbit, Apple
              HealthKit, or Google Fit — we access the data you authorize (for example, steps,
              activity, and heart-rate metrics) to enhance recovery and calorie estimates. You can
              disconnect these integrations at any time, and we only access them with your explicit
              permission.
            </p>

            <SubHeading>Social information (optional)</SubHeading>
            <p>
              If you use social features, we collect your profile (username, avatar, bio) and the
              content you create, such as shared workouts, comments, reactions, follows, and
              leaderboard participation.
            </p>

            <SubHeading>Payment information</SubHeading>
            <p>
              Subscriptions are sold on our website and processed by Stripe. We do not collect or
              store your full payment card details; Stripe processes payments and provides us with
              limited information such as your subscription status and billing period. Our mobile
              apps do not sell subscriptions.
            </p>

            <SubHeading>Device &amp; technical data</SubHeading>
            <p>
              We collect limited technical information necessary to run the Service, such as device
              and browser type, and we use cookies or similar local storage to keep you signed in
              and remember your preferences.
            </p>
          </Section>

          <Section title="2. How We Use Your Information">
            <p>We use your information to:</p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>Provide, maintain, and improve the Service and its features;</li>
              <li>Generate personalized training programs, weight suggestions, and coaching insights;</li>
              <li>Track your progress, volume, recovery, and nutrition over time;</li>
              <li>Process subscriptions and manage your account;</li>
              <li>Communicate with you about your account, security, and updates;</li>
              <li>Protect against fraud, abuse, and security incidents; and</li>
              <li>Comply with legal obligations.</li>
            </ul>
          </Section>

          <Section title="3. AI Processing">
            <p>
              Certain features (such as AI coaching notes, exercise generation, and program design)
              send relevant data — for example, your training history, body-composition context, and
              goals — to our AI provider, Anthropic, to generate responses. This data is processed to
              provide the feature and is not used by us to train AI models. AI-generated guidance is
              informational and is not medical advice.
            </p>
          </Section>

          <Section title="4. How We Share Information">
            <p>
              We do not sell your personal information. We share information only as needed to operate
              the Service, with service providers that process data on our behalf:
            </p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li><strong>Supabase</strong> — database, authentication, and file storage;</li>
              <li><strong>Stripe</strong> — subscription payments (web only);</li>
              <li><strong>Anthropic</strong> — AI coaching and generation features;</li>
              <li><strong>Fitbit, Apple HealthKit, Google Fit</strong> — wearable integrations you choose to connect;</li>
              <li><strong>Food databases</strong> (such as USDA FoodData Central, Open Food Facts, and FatSecret) — to look up nutrition information for foods you search.</li>
            </ul>
            <p>
              We may also share information if required by law, to enforce our terms, to protect the
              rights and safety of our users, or in connection with a merger, acquisition, or sale of
              assets. If you use social features, content you choose to make public (such as shared
              workouts or leaderboard entries) is visible to other users.
            </p>
          </Section>

          <Section title="5. Data Retention">
            <p>
              We retain your information for as long as your account is active or as needed to provide
              the Service. When you delete your account, we delete your personal data associated with
              that account, except where we are required to retain certain records to comply with
              legal obligations or resolve disputes.
            </p>
          </Section>

          <Section title="6. Your Rights &amp; Choices">
            <p>You have control over your data:</p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>
                <strong>Access &amp; export.</strong> You can view your data in the app and export it
                from Settings.
              </li>
              <li>
                <strong>Correction.</strong> You can update your profile and preferences at any time
                in Settings.
              </li>
              <li>
                <strong>Deletion.</strong> You can permanently delete your account and associated data
                directly in the app under <em>Settings &rarr; Account &rarr; Delete Account</em>.
              </li>
              <li>
                <strong>Integrations.</strong> You can disconnect any wearable or health-platform
                integration at any time.
              </li>
            </ul>
            <p>
              Depending on where you live, you may have additional rights under laws such as the GDPR
              or CCPA, including the right to access, correct, delete, or restrict processing of your
              personal data. To exercise these rights, contact us at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary-400 hover:underline">
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </Section>

          <Section title="7. Security">
            <p>
              We use industry-standard measures to protect your information, including encryption in
              transit, hashed passwords, and row-level access controls so that your data is accessible
              only to you. No method of transmission or storage is completely secure, so we cannot
              guarantee absolute security.
            </p>
          </Section>

          <Section title="8. Children's Privacy">
            <p>
              The Service is not intended for children under 13, and we do not knowingly collect
              personal information from children under 13. If you believe a child has provided us with
              personal information, please contact us so we can delete it.
            </p>
          </Section>

          <Section title="9. International Users">
            <p>
              We operate the Service from, and store data in, facilities that may be located outside
              your country. By using the Service, you consent to the transfer and processing of your
              information in countries that may have different data-protection laws than your own.
            </p>
          </Section>

          <Section title="10. Changes to This Policy">
            <p>
              We may update this Privacy Policy from time to time. When we do, we will revise the
              &ldquo;Last updated&rdquo; date above and, for material changes, provide additional
              notice within the Service. Your continued use of the Service after an update means you
              accept the revised policy.
            </p>
          </Section>

          <Section title="11. Contact Us">
            <p>
              If you have questions or requests regarding this Privacy Policy or your data, contact us
              at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary-400 hover:underline">
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-2xl font-bold text-surface-100">{title}</h2>
      {children}
    </section>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-lg font-semibold text-surface-200 pt-2">{children}</h3>;
}
