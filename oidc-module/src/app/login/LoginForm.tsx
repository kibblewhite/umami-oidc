/**
 * LoginForm with OIDC support
 *
 * This is a modified version of Umami's LoginForm component that adds
 * the OIDC login button below the standard username/password form.
 *
 * OPTION A: Replace the existing file at src/app/login/LoginForm.tsx
 * OPTION B: Apply the diff shown at the bottom of this file manually
 *
 * The only changes from the original are:
 *   1. Import OidcLoginButton
 *   2. Render <OidcLoginButton /> after the form submit button
 *   3. Show OIDC error messages from URL params
 */

'use client';

import {
  Column,
  Form,
  FormButtons,
  FormField,
  FormSubmitButton,
  Heading,
  Icon,
  PasswordField,
  TextField,
} from '@umami/react-zen';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMessages, useUpdateQuery } from '@/components/hooks';
import { Logo } from '@/components/svg';
import { setClientAuthToken } from '@/lib/client';
import { setUser } from '@/store/app';
import { OidcLoginButton } from './OidcLoginButton';

export function LoginForm() {
  const { formatMessage, labels, getErrorMessage } = useMessages();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { mutateAsync, error } = useUpdateQuery('/auth/login');

  // Check for OIDC error from the callback redirect
  const oidcError = searchParams.get('error');

  const handleSubmit = async (data: any) => {
    await mutateAsync(data, {
      onSuccess: async ({ token, user }: { token: string; user: any }) => {
        setClientAuthToken(token);
        setUser(user);
        router.push('/');
      },
    });
  };

  return (
    <Column justifyContent="center" alignItems="center" gap="6">
      <Icon size="lg">
        <Logo />
      </Icon>
      <Heading>umami</Heading>

      {/* Show OIDC error if present */}
      {oidcError && (
        <div
          style={{
            padding: '8px 16px',
            backgroundColor: 'var(--red100, #fee)',
            color: 'var(--red900, #c00)',
            borderRadius: '4px',
            fontSize: '13px',
            maxWidth: '320px',
            textAlign: 'center',
          }}
        >
          {oidcError}
        </div>
      )}

      <Form onSubmit={handleSubmit} error={getErrorMessage(error)}>
        <FormField
          label={formatMessage(labels.username)}
          data-test="input-username"
          name="username"
        >
          <TextField autoComplete="off" />
        </FormField>
        <FormField
          label={formatMessage(labels.password)}
          data-test="input-password"
          name="password"
        >
          <PasswordField />
        </FormField>
        <FormButtons flex>
          <FormSubmitButton variant="primary" data-test="button-submit">
            {formatMessage(labels.login)}
          </FormSubmitButton>
        </FormButtons>

        {/* ========== OIDC SSO BUTTON ========== */}
        <OidcLoginButton />
        {/* ===================================== */}
      </Form>
    </Column>
  );
}
