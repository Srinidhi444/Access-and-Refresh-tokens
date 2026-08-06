import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Signin() {
  const { signin, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await signin(form.email, form.password);
      navigate(location.state?.from?.pathname || '/dashboard', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid email or password.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card glass-panel" aria-labelledby="signin-title">
        <div className="brand-mark">AUTH / 01</div>
        <p className="eyebrow">Welcome back</p>
        <h1 id="signin-title">Sign in securely.</h1>
        <p className="muted">Your access token stays in memory. Your session is renewed securely in the background.</p>

        <form onSubmit={handleSubmit} className="form-stack">
          <label>
            Email
            <input name="email" type="email" autoComplete="email" value={form.email} onChange={updateField} placeholder="you@example.com" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" value={form.password} onChange={updateField} placeholder="At least 8 characters" required />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="switch-auth">New here? <Link to="/signup">Create an account</Link></p>
      </section>
    </main>
  );
}