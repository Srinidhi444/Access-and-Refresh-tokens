import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Signup() {
  const { signup, isAuthenticated } = useAuth();
  const navigate = useNavigate();
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

    if (form.password.length < 8) {
      setError('Password must contain at least 8 characters.');
      return;
    }

    setIsSubmitting(true);
    try {
      await signup(form.email, form.password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to create your account.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card glass-panel" aria-labelledby="signup-title">
        <div className="brand-mark">AUTH / 02</div>
        <p className="eyebrow">Get started</p>
        <h1 id="signup-title">Create your account.</h1>
        <p className="muted">A simple production-style authentication flow with rotating sessions.</p>

        <form onSubmit={handleSubmit} className="form-stack">
          <label>
            Email
            <input name="email" type="email" autoComplete="email" value={form.email} onChange={updateField} placeholder="you@example.com" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="new-password" value={form.password} onChange={updateField} placeholder="At least 8 characters" minLength="8" required />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="switch-auth">Already registered? <Link to="/signin">Sign in</Link></p>
      </section>
    </main>
  );
}