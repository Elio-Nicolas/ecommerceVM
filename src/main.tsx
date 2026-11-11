import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AdminPanel from './AdminPanel'
import AdminOrders from './AdminOrders'
import './index.css'
import PaymentReturnPage from './PaymentReturnPage'

const isAdminOrdersRoute = window.location.pathname === '/admin/pedidos'
const isAdminRoute = window.location.pathname.startsWith('/admin')
const paymentParams = new URLSearchParams(window.location.search)
const paymentOutcome = paymentParams.get('payment')
const paymentOrderId = paymentParams.get('order')
const isPaymentReturnRoute = !isAdminRoute
  && ['success', 'failure', 'pending'].includes(paymentOutcome || '')
  && /^[0-9a-f-]{36}$/i.test(paymentOrderId || '')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isPaymentReturnRoute ? <PaymentReturnPage orderId={paymentOrderId!} outcome={paymentOutcome as 'success' | 'failure' | 'pending'} /> : isAdminOrdersRoute ? <AdminOrders /> : isAdminRoute ? <AdminPanel /> : <App />}
  </React.StrictMode>,
)
