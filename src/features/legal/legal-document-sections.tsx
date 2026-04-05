import type { ReactNode } from "react";
import Link from "next/link";
import { LegalList, LegalSection } from "@/components/layout/legal-doc-layout";

const privacyLinkClass =
  "font-medium text-blue-600 underline-offset-2 hover:underline";

export function PrivacyPolicySections() {
  return (
    <>
      <p>
        CaseLink (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;the application&rdquo;) is a tool
        designed to help case managers organize information and generate action plans for families.
        This Privacy Policy explains what information we collect, how we use it, and how it is
        handled.
      </p>

      <LegalSection n="1" title="Information We Collect">
        <h3 className="text-base font-semibold text-slate-900">Account Information</h3>
        <p>When you create an account, we collect:</p>
        <LegalList
          items={[
            "Email address",
            "Authentication credentials (managed by our authentication provider)",
            "Basic profile information (such as name, organization, or role, if provided)",
          ]}
        />

        <h3 className="pt-2 text-base font-semibold text-slate-900">User-Provided Content</h3>
        <p>
          The application allows users to input and manage case-related information, including:
        </p>
        <LegalList
          items={[
            "Family or household details",
            "Case notes and summaries",
            "Barriers, goals, and plans",
            "Task and referral information",
          ]}
        />
        <p>
          This information is entered by users and may include sensitive personal context depending
          on how the application is used.
        </p>

        <h3 className="pt-2 text-base font-semibold text-slate-900">
          Automatically Collected Information
        </h3>
        <p>We may collect limited technical information, including:</p>
        <LegalList
          items={[
            "Session and authentication data (via cookies)",
            "Basic request metadata (such as timestamps)",
            "IP address (used for security and rate limiting purposes only)",
          ]}
        />
        <p>We do not use tracking cookies or third-party advertising analytics.</p>
      </LegalSection>

      <LegalSection n="2" title="How We Use Information">
        <p>We use collected information to:</p>
        <LegalList
          items={[
            "Provide and operate the application",
            "Store and manage case-related data",
            "Generate action plans and recommendations",
            "Improve reliability, performance, and security",
          ]}
        />
      </LegalSection>

      <LegalSection n="3" title="Use of AI Services">
        <p>
          CaseLink uses third-party AI services, including OpenAI, to generate plans, suggestions,
          and responses.
        </p>
        <p>When AI features are used:</p>
        <LegalList
          items={[
            "User-provided content (such as case details, notes, and questions) may be sent to these services",
            "This data is used to generate responses within the application",
            "We do not control how third-party providers process data beyond their stated policies",
          ]}
        />
        <p>Users should avoid entering unnecessary sensitive personal information when possible.</p>
      </LegalSection>

      <LegalSection n="4" title="Data Storage and Processing">
        <p>
          We use Supabase to store application data, including user accounts and case information.
        </p>
        <p>Data is stored in a database with access controls designed to ensure that:</p>
        <LegalList
          items={[
            "Users can only access data associated with their account or organization",
            "Access is restricted using row-level security policies",
          ]}
        />
        <p>The application may be hosted on infrastructure providers such as Vercel.</p>
      </LegalSection>

      <LegalSection n="5" title="Cookies and Sessions">
        <p>We use cookies and similar technologies to:</p>
        <LegalList items={["Maintain user sessions", "Authenticate users securely"]} />
        <p>
          These cookies are strictly necessary for the application to function and are not used for
          tracking or advertising.
        </p>
      </LegalSection>

      <LegalSection n="6" title="Data Sharing">
        <p>We do not sell or share personal data for advertising purposes.</p>
        <p>Data may be shared only with:</p>
        <LegalList
          items={[
            "Infrastructure and service providers (e.g., Supabase, OpenAI)",
            "As required for application functionality",
          ]}
        />
      </LegalSection>

      <LegalSection n="7" title="Data Retention">
        <p>Data is stored as long as it is needed to operate the application.</p>
        <p>Currently:</p>
        <LegalList
          items={[
            "Users can delete or archive certain records within the app",
            "Full account deletion workflows may not be available in-app",
          ]}
        />
        <p>If you would like your data deleted, you may contact us directly.</p>
      </LegalSection>

      <LegalSection n="8" title="Access and Organizational Use">
        <p>CaseLink is designed for use by case managers and organizations.</p>
        <p>Depending on configuration:</p>
        <LegalList
          items={[
            "Data associated with a family or case may be accessible to assigned users or administrators within the same organization",
            "Access is controlled through application permissions and database policies",
          ]}
        />
      </LegalSection>

      <LegalSection n="9" title="Security">
        <p>We implement technical measures to protect data, including:</p>
        <LegalList
          items={[
            "Authentication and session management",
            "Row-level database access controls",
            "Input validation and rate limiting",
            "Secure handling of API keys and server-side processing",
          ]}
        />
        <p>
          No system is completely secure, but we take reasonable steps to protect user data.
        </p>
      </LegalSection>

      <LegalSection n="10" title="Limitations">
        <p>CaseLink is a support tool and:</p>
        <LegalList
          items={[
            "Does not provide legal, medical, or financial advice",
            "Does not guarantee accuracy of AI-generated content",
          ]}
        />
        <p>Users are responsible for reviewing and validating all outputs.</p>
      </LegalSection>

      <LegalSection n="11" title="Changes to This Policy">
        <p>
          We may update this Privacy Policy from time to time. Updates will be reflected by the
          &ldquo;Last updated&rdquo; date.
        </p>
      </LegalSection>

      <LegalSection n="12" title="Contact">
        <p>
          If you have questions or requests related to this Privacy Policy, you can contact us at:
        </p>
        <p>
          <a href="mailto:willsanz23@gmail.com" className={privacyLinkClass}>
            willsanz23@gmail.com
          </a>
        </p>
      </LegalSection>
    </>
  );
}

export function TermsOfServiceSections(
  props?: {
    /** Defaults to a route link to /privacy. In modals, pass a button that switches documents. */
    privacyPolicyLink?: ReactNode;
  },
) {
  const { privacyPolicyLink } = props ?? {};
  const privacyLink =
    privacyPolicyLink ?? (
      <Link href="/privacy" className={privacyLinkClass}>
        Privacy Policy
      </Link>
    );

  return (
    <>
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your use of CaseLink (&ldquo;the
        application&rdquo;).
      </p>
      <p>By using the application, you agree to these Terms.</p>

      <LegalSection n="1" title="Use of the Application">
        <p>
          CaseLink is a tool designed to assist case managers in organizing information and
          generating action plans.
        </p>
        <p>You agree to use the application:</p>
        <LegalList
          items={[
            "Only for lawful purposes",
            "In a manner consistent with its intended use",
            "Without attempting to misuse, disrupt, or exploit the system",
          ]}
        />
      </LegalSection>

      <LegalSection n="2" title="User Responsibilities">
        <p>You are responsible for:</p>
        <LegalList
          items={[
            "The accuracy of information you enter",
            "Ensuring you have the right to input and use any data",
            "Reviewing all generated outputs before relying on them",
          ]}
        />
        <p>You should avoid entering unnecessary sensitive personal information.</p>
      </LegalSection>

      <LegalSection n="3" title="AI-Generated Content">
        <p>The application uses AI to generate suggestions and plans.</p>
        <p>You acknowledge that:</p>
        <LegalList
          items={[
            "AI-generated content may be incomplete or inaccurate",
            "Outputs are provided for assistance only",
            "You are responsible for reviewing and validating all outputs",
          ]}
        />
        <p>CaseLink does not provide professional advice.</p>
      </LegalSection>

      <LegalSection n="4" title="Accounts">
        <p>To use certain features, you must create an account.</p>
        <p>You are responsible for:</p>
        <LegalList
          items={[
            "Maintaining the security of your account",
            "Keeping your credentials confidential",
            "All activity under your account",
          ]}
        />
        <p>We may suspend or restrict access if misuse is detected.</p>
      </LegalSection>

      <LegalSection n="5" title="Data and Privacy">
        <p>Your use of the application is also governed by the {privacyLink}.</p>
        <p>By using the application, you acknowledge that:</p>
        <LegalList
          items={[
            "Data you provide may be processed by third-party services (such as AI providers)",
            "Data is stored and managed using external infrastructure providers",
          ]}
        />
      </LegalSection>

      <LegalSection n="6" title="Availability and Changes">
        <p>We may:</p>
        <LegalList
          items={[
            "Modify or update the application at any time",
            "Add or remove features",
            "Limit or discontinue access",
          ]}
        />
        <p>We are not liable for interruptions or changes to the service.</p>
      </LegalSection>

      <LegalSection n="7" title="No Warranty">
        <p>The application is provided &ldquo;as is&rdquo; without warranties of any kind.</p>
        <p>We do not guarantee:</p>
        <LegalList
          items={[
            "Accuracy of outputs",
            "Continuous availability",
            "Fitness for a particular purpose",
          ]}
        />
      </LegalSection>

      <LegalSection n="8" title="Limitation of Liability">
        <p>To the fullest extent permitted by law, CaseLink is not liable for:</p>
        <LegalList
          items={[
            "Any decisions made based on application outputs",
            "Loss of data",
            "Indirect or consequential damages",
          ]}
        />
      </LegalSection>

      <LegalSection n="9" title="Termination">
        <p>We may suspend or terminate access if:</p>
        <LegalList items={["These Terms are violated", "The application is misused"]} />
      </LegalSection>

      <LegalSection n="10" title="Changes to Terms">
        <p>
          We may update these Terms from time to time. Continued use of the application constitutes
          acceptance of the updated Terms.
        </p>
      </LegalSection>

      <LegalSection n="11" title="Contact">
        <p>For questions about these Terms, contact:</p>
        <p>
          <a href="mailto:willsanz23@gmail.com" className={privacyLinkClass}>
            willsanz23@gmail.com
          </a>
        </p>
      </LegalSection>
    </>
  );
}
