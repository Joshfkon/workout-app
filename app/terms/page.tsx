import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms governing your use of HyperTrack.',
};

// Update this whenever the terms change.
const LAST_UPDATED = 'June 29, 2026';
const CONTACT_EMAIL = 'support@hypertrack.app';

export default function TermsOfServicePage() {
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

        <h1 className="text-4xl font-black text-surface-100 mb-2">Terms of Service</h1>
        <p className="text-surface-400 mb-10">Last updated: {LAST_UPDATED}</p>

        <div className="space-y-10 text-surface-300 leading-relaxed">
          <section className="space-y-3">
            <p>
              These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of
              HyperTrack (the &ldquo;Service&rdquo;), provided by HyperTrack (&ldquo;HyperTrack,&rdquo;
              &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;). By creating an account or using
              the Service, you agree to these Terms and to our{' '}
              <Link href="/privacy" className="text-primary-400 hover:underline">Privacy Policy</Link>.
              If you do not agree, do not use the Service.
            </p>
          </section>

          <Section title="1. Eligibility">
            <p>
              You must be at least 13 years old to use the Service. If you are under the age of
              majority where you live, you may use the Service only with the involvement of a parent
              or legal guardian. By using the Service, you represent that you meet these requirements.
            </p>
          </Section>

          <Section title="2. Your Account">
            <p>
              You are responsible for the information you provide, for keeping your login credentials
              secure, and for all activity that occurs under your account. Notify us promptly of any
              unauthorized use. You may delete your account at any time from{' '}
              <em>Settings &rarr; Account &rarr; Delete Account</em>.
            </p>
          </Section>

          <Section title="3. Health &amp; Fitness Disclaimer">
            <p>
              <strong>
                HyperTrack is a fitness and nutrition tracking tool, not a medical device or
                healthcare provider.
              </strong>{' '}
              The training programs, weight suggestions, nutrition targets, coaching notes, and other
              outputs are for informational and educational purposes only and are not medical,
              nutritional, or professional advice.
            </p>
            <p>
              Consult a qualified physician or healthcare professional before beginning any exercise
              or nutrition program, especially if you have a medical condition, are pregnant, are
              taking medication (including GLP-1 medications), or have any concerns about your health.
              You assume full responsibility for your training and dietary choices and acknowledge
              that physical exercise carries inherent risks, including the risk of injury. Stop and
              seek medical attention if you experience pain, dizziness, or other symptoms.
            </p>
          </Section>

          <Section title="4. AI-Generated Content">
            <p>
              Some features use artificial intelligence to generate programs, suggestions, and
              coaching notes based on the data you provide. AI output may be inaccurate or incomplete
              and should be reviewed with judgment. It does not constitute medical advice, and you use
              it at your own discretion.
            </p>
          </Section>

          <Section title="5. Subscriptions &amp; Billing">
            <p>
              The Service offers free and paid subscription tiers. Paid subscriptions are sold and
              billed through our website using our payment processor, Stripe; our mobile apps do not
              sell subscriptions. Paid plans renew automatically at the end of each billing period
              until canceled.
            </p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>You can cancel at any time; access continues until the end of the current billing period.</li>
              <li>Free trials, if offered, convert to a paid subscription unless canceled before the trial ends.</li>
              <li>Prices may change; we will give notice of changes before they take effect.</li>
              <li>Except where required by law or expressly stated, payments are non-refundable.</li>
            </ul>
          </Section>

          <Section title="6. Acceptable Use">
            <p>You agree not to:</p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>Use the Service for any unlawful purpose or in violation of these Terms;</li>
              <li>Attempt to access accounts, data, or systems you are not authorized to access;</li>
              <li>Reverse engineer, scrape, or disrupt the Service or its infrastructure;</li>
              <li>Upload content that is unlawful, infringing, harassing, or harmful; or</li>
              <li>Misrepresent your identity or impersonate others.</li>
            </ul>
          </Section>

          <Section title="7. User Content &amp; Social Features">
            <p>
              You retain ownership of the content you create (such as workouts, notes, and profile
              information). By sharing content through social features, you grant us a non-exclusive
              license to host and display it as needed to operate those features. You are responsible
              for the content you share and for respecting others. We may remove content that violates
              these Terms.
            </p>
          </Section>

          <Section title="8. Intellectual Property">
            <p>
              The Service, including its software, design, content, and trademarks, is owned by
              HyperTrack and its licensors and is protected by intellectual-property laws. We grant you
              a limited, non-exclusive, non-transferable, revocable license to use the Service for your
              personal, non-commercial use, subject to these Terms.
            </p>
          </Section>

          <Section title="9. Third-Party Services">
            <p>
              The Service integrates with third-party providers (such as Supabase, Stripe, Anthropic,
              Fitbit, Apple Health, Google Fit, and nutrition databases). Your use of those
              integrations may be subject to the third party&rsquo;s own terms, and we are not
              responsible for third-party services.
            </p>
          </Section>

          <Section title="10. Disclaimer of Warranties">
            <p>
              The Service is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without
              warranties of any kind, whether express or implied, including warranties of
              merchantability, fitness for a particular purpose, and non-infringement. We do not
              warrant that the Service will be uninterrupted, error-free, or that any result or goal
              will be achieved.
            </p>
          </Section>

          <Section title="11. Limitation of Liability">
            <p>
              To the fullest extent permitted by law, HyperTrack and its affiliates will not be liable
              for any indirect, incidental, special, consequential, or punitive damages, or for any
              loss of data, profits, or goodwill, arising from your use of the Service. Our total
              liability for any claim relating to the Service will not exceed the greater of the amount
              you paid us in the twelve months before the claim or USD $50.
            </p>
          </Section>

          <Section title="12. Indemnification">
            <p>
              You agree to indemnify and hold harmless HyperTrack and its affiliates from any claims,
              damages, or expenses arising out of your use of the Service, your content, or your
              violation of these Terms.
            </p>
          </Section>

          <Section title="13. Termination">
            <p>
              You may stop using the Service and delete your account at any time. We may suspend or
              terminate your access if you violate these Terms or to protect the Service or other
              users. Provisions that by their nature should survive termination will survive.
            </p>
          </Section>

          <Section title="14. Apple App Store">
            <p>
              If you download the app from the Apple App Store, you acknowledge that these Terms are
              between you and HyperTrack only, not Apple, and that Apple is not responsible for the app
              or its content. Apple and its subsidiaries are third-party beneficiaries of these Terms
              and may enforce them against you. Your use of the app must also comply with the Apple
              Media Services Terms and the App Store Usage Rules.
            </p>
          </Section>

          <Section title="15. Changes to These Terms">
            <p>
              We may update these Terms from time to time. When we do, we will revise the &ldquo;Last
              updated&rdquo; date above and, for material changes, provide additional notice within the
              Service. Your continued use of the Service after an update means you accept the revised
              Terms.
            </p>
          </Section>

          <Section title="16. Governing Law">
            <p>
              These Terms are governed by the laws of the jurisdiction in which HyperTrack operates,
              without regard to conflict-of-laws principles. Any disputes will be resolved in the
              courts located there, unless applicable law requires otherwise.
            </p>
          </Section>

          <Section title="17. Contact Us">
            <p>
              Questions about these Terms? Contact us at{' '}
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
