import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { formatPrice } from './products'
import ShippingOriginsPanel from './ShippingOriginsPanel'
import ShippingSettingsPanel from './ShippingSettingsPanel'
import ArcaSettingsPanel from './ArcaSettingsPanel'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:7381').replace(/\/$/, '')
const TOKEN_KEY = 'ecommercevm_admin_token'

type Category = { id: string; name: string; slug: string; description?: string | null; _count?: { products: number } }
type ProductStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
type Product = {
  id: string; sku: string; slug: string; name: string; description: string
  priceArs: number; compareAtArs: number | null; stock: number
  weightGrams: number | null; packageLengthCm: number | null; packageWidthCm: number | null; packageHeightCm: number | null; status: ProductStatus
  featured: boolean; badge: string | null; imageUrl: string | null; specs: string[]
  categoryId: string; category: { id: string; name: string }
}
type ProductForm = {
  sku: string; slug: string; name: string; description: string
  priceArs: string; compareAtArs: string; stock: string
  weightGrams: string; packageLengthCm: string; packageWidthCm: string; packageHeightCm: string; status: ProductStatus
  featured: boolean; badge: string; imageUrl: string; specs: string; categoryId: string
}
const emptyForm: ProductForm = {
  sku: '', slug: '', name: '', description: '', priceArs: '', compareAtArs: '',
  stock: '0', weightGrams: '', packageLengthCm: '', packageWidthCm: '', packageHeightCm: '', status: 'DRAFT', featured: false, badge: '', imageUrl: '', specs: '', categoryId: '',
}

async function request<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error?.message || 'No se pudo completar la operación.')
  return payload as T
}

function toForm(product: Product): ProductForm {
  return {
    sku: product.sku, slug: product.slug, name: product.name, description: product.description,
    priceArs: String(product.priceArs), compareAtArs: product.compareAtArs == null ? '' : String(product.compareAtArs),
    stock: String(product.stock), weightGrams: product.weightGrams == null ? '' : String(product.weightGrams),
    packageLengthCm: product.packageLengthCm == null ? '' : String(product.packageLengthCm),
    packageWidthCm: product.packageWidthCm == null ? '' : String(product.packageWidthCm),
    packageHeightCm: product.packageHeightCm == null ? '' : String(product.packageHeightCm),
    status: product.status, featured: product.featured,
    badge: product.badge || '', imageUrl: product.imageUrl || '', specs: product.specs.join(', '),
    categoryId: product.categoryId,
  }
}

function slugify(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export default function AdminPanel() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [authenticated, setAuthenticated] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [editing, setEditing] = useState<Product | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<ProductForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [imageUploading, setImageUploading] = useState(false)
  const [categoryName, setCategoryName] = useState('')
  const [categorySlug, setCategorySlug] = useState('')
  const [categoryDescription, setCategoryDescription] = useState('')
  const [categoryEditing, setCategoryEditing] = useState<string | null>(null)
  const [categorySaving, setCategorySaving] = useState(false)

  const loadData = useCallback(async (authToken: string) => {
    setLoading(true)
    try {
      const [productResult, categoryResult] = await Promise.all([
        request<{ data: Product[] }>('/admin/products?limit=100', authToken),
        request<{ data: Category[] }>('/admin/categories', authToken),
      ])
      setProducts(productResult.data)
      setCategories(categoryResult.data)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar el catálogo.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!token) {
      setCheckingSession(false)
      return
    }
    let active = true
    request<{ data: { email: string } }>('/auth/me', token)
      .then((result) => {
        if (!active) return
        setAdminEmail(result.data.email)
        setAuthenticated(true)
        void loadData(token)
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY)
        if (active) setToken('')
      })
      .finally(() => { if (active) setCheckingSession(false) })
    return () => { active = false }
  }, [token, loadData])

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es')
    return products.filter((product) =>
      (statusFilter === 'ALL' || product.status === statusFilter) &&
      (!term || `${product.name} ${product.sku} ${product.category.name}`.toLocaleLowerCase('es').includes(term)),
    )
  }, [products, search, statusFilter])

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await request<{ data: { token: string; admin: { email: string } } }>('/auth/login', undefined, {
        method: 'POST', body: JSON.stringify({ email, password }),
      })
      localStorage.setItem(TOKEN_KEY, result.data.token)
      setToken(result.data.token)
      setAdminEmail(result.data.admin.email)
      setAuthenticated(true)
      setPassword('')
      await loadData(result.data.token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo iniciar sesión.')
    } finally {
      setLoading(false)
    }
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY)
    setToken('')
    setAuthenticated(false)
    setAdminEmail('')
    setProducts([])
    setEditing(null)
    setNotice('')
    setError('')
  }

  function openNewProduct() {
    setFormOpen(true)
    setEditing(null)
    setForm({ ...emptyForm, categoryId: categories[0]?.id || '' })
    setError('')
    setNotice('')
  }

  function openEditProduct(product: Product) {
    setFormOpen(true)
    setEditing(product)
    setForm(toForm(product))
    setError('')
    setNotice('')
  }

  function updateField<K extends keyof ProductForm>(key: K, value: ProductForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token) return
    setSaving(true)
    setError('')
    setNotice('')
    const payload = {
      sku: form.sku.trim(), slug: form.slug.trim(), name: form.name.trim(),
      description: form.description.trim(), priceArs: Number(form.priceArs),
      compareAtArs: form.compareAtArs.trim() ? Number(form.compareAtArs) : null,
      stock: Number(form.stock),
      weightGrams: form.weightGrams.trim() ? Number(form.weightGrams) : null,
      packageLengthCm: form.packageLengthCm.trim() ? Number(form.packageLengthCm) : null,
      packageWidthCm: form.packageWidthCm.trim() ? Number(form.packageWidthCm) : null,
      packageHeightCm: form.packageHeightCm.trim() ? Number(form.packageHeightCm) : null,
      status: form.status, featured: form.featured,
      badge: form.badge.trim() || null, imageUrl: form.imageUrl.trim() || null,
      specs: form.specs.split(',').map((item) => item.trim()).filter(Boolean),
      categoryId: form.categoryId,
    }
    try {
      if (editing) {
        await request(`/admin/products/${editing.id}`, token, { method: 'PUT', body: JSON.stringify(payload) })
        setNotice('Producto actualizado correctamente.')
      } else {
        await request('/admin/products', token, { method: 'POST', body: JSON.stringify(payload) })
        setNotice('Producto creado correctamente.')
      }
      setEditing(null)
      setFormOpen(false)
      await loadData(token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el producto.')
    } finally {
      setSaving(false)
    }
  }

  async function uploadProductImage(file: File) {
    if (!token) return
    setImageUploading(true)
    setError('')
    setNotice('')
    try {
      const body = new FormData()
      body.append('image', file)
      const response = await fetch(`${API_URL}/api/v1/admin/storage/images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error?.message || 'No se pudo subir la imagen.')
      updateField('imageUrl', payload.data.imageUrl)
      setNotice('Imagen subida correctamente. Guardá el producto para aplicar el cambio.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo subir la imagen.')
    } finally {
      setImageUploading(false)
    }
  }

  function resetCategoryForm() {
    setCategoryEditing(null); setCategoryName(''); setCategorySlug(''); setCategoryDescription('')
  }
  function editCategory(category: Category) {
    setCategoryEditing(category.id); setCategoryName(category.name); setCategorySlug(category.slug)
    setCategoryDescription(category.description || ''); setError(''); setNotice('')
  }
  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token) return
    setCategorySaving(true); setError(''); setNotice('')
    try {
      const payload = { name: categoryName.trim(), slug: categorySlug.trim(), description: categoryDescription.trim() || null }
      if (categoryEditing) {
        await request(`/admin/categories/${categoryEditing}`, token, { method: 'PUT', body: JSON.stringify(payload) })
        setNotice('Categoría actualizada correctamente.')
      } else {
        await request('/admin/categories', token, { method: 'POST', body: JSON.stringify(payload) })
        setNotice('Categoría creada correctamente.')
      }
      resetCategoryForm(); await loadData(token)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar la categoría.') }
    finally { setCategorySaving(false) }
  }
  async function deleteCategory(category: Category) {
    if (!token || !window.confirm(`¿Eliminar la categoría "${category.name}"?`)) return
    setError(''); setNotice('')
    try {
      await request(`/admin/categories/${category.id}`, token, { method: 'DELETE' })
      setNotice('Categoría eliminada.'); await loadData(token)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo eliminar la categoría.') }
  }

  async function archiveProduct(product: Product) {
    if (!token || !window.confirm(`¿Archivar "${product.name}"? Dejará de mostrarse en la tienda, pero conservará sus datos.`)) return
    setError('')
    setNotice('')
    try {
      await request(`/admin/products/${product.id}`, token, { method: 'DELETE' })
      setNotice('Producto archivado. Podés volver a activarlo editándolo.')
      await loadData(token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo archivar el producto.')
    }
  }

  if (checkingSession) return <div className="admin-loading">Verificando sesión...</div>

  if (!authenticated) return (
    <main className="admin-login-page">
      <a className="admin-brand" href="/"><span className="admin-brand-mark">TV</span><span>Tu Tienda<span>VM</span></span></a>
      <form className="admin-login-card" onSubmit={handleLogin}>
        <div className="admin-kicker">ÁREA PRIVADA</div>
        <h1>Bienvenido de nuevo.</h1>
        <p>Ingresá para administrar el catálogo de la tienda.</p>
        {error && <div className="admin-alert error">{error}</div>}
        <label>Correo electrónico<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        <button className="admin-primary" disabled={loading}>{loading ? 'Ingresando...' : 'Iniciar sesión'}</button>
        <a className="admin-back-link" href="/">Volver a la tienda</a>
      </form>
      <span className="admin-login-caption">Tu TiendaVM · Administración</span>
    </main>
  )

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <a className="admin-brand" href="/"><span className="admin-brand-mark">TV</span><span>Tu Tienda<span>VM</span></span></a>
        <div className="admin-nav-label">GESTIÓN</div>
        <a className="admin-nav-item active" href="/admin"><span className="admin-nav-icon">▦</span> Productos</a>
        <a className="admin-nav-item" href="/admin/pedidos"><span className="admin-nav-icon">▤</span> Pedidos</a>
        <div className="admin-sidebar-bottom"><span className="admin-avatar">{adminEmail.slice(0, 1).toUpperCase()}</span><div><strong>{adminEmail}</strong><small>Administrador</small></div><button onClick={logout} title="Cerrar sesión">↗</button></div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar"><div><span>TU TIENDAVM / ADMINISTRACIÓN</span><h1>Productos</h1></div><a href="/" className="admin-store-link">Ver tienda ↗</a></header>
        <section className="admin-content">
          <div className="admin-page-heading"><div><h2>Catálogo</h2><p>Administrá productos, precios, disponibilidad e imágenes.</p></div><button className="admin-primary admin-new-button" onClick={openNewProduct}>＋ Nuevo producto</button></div>
          <div className="admin-stats">
            <div><span>PRODUCTOS</span><strong>{products.length}</strong></div>
            <div><span>PUBLICADOS</span><strong>{products.filter((item) => item.status === 'ACTIVE').length}</strong></div>
            <div><span>BORRADORES</span><strong>{products.filter((item) => item.status === 'DRAFT').length}</strong></div>
            <div><span>STOCK TOTAL</span><strong>{products.reduce((total, item) => total + item.stock, 0).toLocaleString('es-AR')}</strong></div>
          </div>
          <section className="admin-category-card">
            <div className="admin-category-heading"><h2>Categorías</h2><p>Organizá el catálogo y asigná productos.</p></div>
            <form className="admin-category-form" onSubmit={saveCategory}>
              <label>Nombre<input value={categoryName} onChange={(event) => { setCategoryName(event.target.value); if (!categoryEditing) setCategorySlug(slugify(event.target.value)) }} required minLength={2} maxLength={80} /></label>
              <label>Slug<input value={categorySlug} onChange={(event) => setCategorySlug(slugify(event.target.value))} required /></label>
              <label>Descripción<input value={categoryDescription} onChange={(event) => setCategoryDescription(event.target.value)} maxLength={500} /></label>
              <div className="admin-category-actions"><button className="admin-primary" disabled={categorySaving}>{categorySaving ? 'Guardando...' : categoryEditing ? 'Guardar cambios' : '＋ Agregar'}</button>{categoryEditing && <button type="button" className="admin-quiet-button" onClick={resetCategoryForm}>Cancelar</button>}</div>
            </form>
            <div className="admin-category-list">{categories.map((category) => <div className="admin-category-row" key={category.id}><div><strong>{category.name}</strong><small>{category.slug} · {category._count?.products ?? 0} productos</small></div><div><button type="button" onClick={() => editCategory(category)}>Editar</button><button type="button" className="archive-action" onClick={() => deleteCategory(category)}>Eliminar</button></div></div>)}</div>
          </section>
          <ShippingSettingsPanel token={token} />
          <ArcaSettingsPanel token={token} />
          <ShippingOriginsPanel token={token} />
          {notice && <div className="admin-alert success">{notice}</div>}
          {error && <div className="admin-alert error">{error}</div>}
          {formOpen ? (
            <form className="admin-form-card" onSubmit={saveProduct}>
              <div className="admin-form-heading"><div><span className="admin-kicker">{editing ? 'EDITAR CATÁLOGO' : 'NUEVO REGISTRO'}</span><h2>{editing ? 'Editar producto' : 'Crear producto'}</h2></div><button type="button" className="admin-quiet-button" onClick={() => { setEditing(null); setFormOpen(false) }}>Cancelar</button></div>
              <div className="admin-form-grid">
                <label>Nombre del producto<input value={form.name} onChange={(event) => { updateField('name', event.target.value); if (!editing) updateField('slug', slugify(event.target.value)) }} required minLength={2} /></label>
                <label>SKU<input value={form.sku} onChange={(event) => updateField('sku', event.target.value)} required /></label>
                <label>Slug / URL<input value={form.slug} onChange={(event) => updateField('slug', slugify(event.target.value))} required /></label>
                <label>Categoría<select value={form.categoryId} onChange={(event) => updateField('categoryId', event.target.value)} required><option value="">Seleccionar categoría</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label>Precio (ARS)<input type="number" min="1" step="1" value={form.priceArs} onChange={(event) => updateField('priceArs', event.target.value)} required /></label>
                <label>Precio anterior (ARS)<input type="number" min="1" step="1" value={form.compareAtArs} onChange={(event) => updateField('compareAtArs', event.target.value)} /></label>
                <label>Stock disponible<input type="number" min="0" step="1" value={form.stock} onChange={(event) => updateField('stock', event.target.value)} required /></label>
                <label>Peso del paquete (gramos)<input type="number" min="1" max="1000000" step="1" value={form.weightGrams} onChange={(event) => updateField('weightGrams', event.target.value)} placeholder="Ej. 850" /></label>
                <label>Largo del paquete (cm)<input type="number" min="1" max="300" step="1" value={form.packageLengthCm} onChange={(event) => updateField('packageLengthCm', event.target.value)} placeholder="Ej. 25" /></label>
                <label>Ancho del paquete (cm)<input type="number" min="1" max="300" step="1" value={form.packageWidthCm} onChange={(event) => updateField('packageWidthCm', event.target.value)} placeholder="Ej. 18" /></label>
                <label>Alto del paquete (cm)<input type="number" min="1" max="300" step="1" value={form.packageHeightCm} onChange={(event) => updateField('packageHeightCm', event.target.value)} placeholder="Ej. 12" /></label>
                <label>Estado<select value={form.status} onChange={(event) => updateField('status', event.target.value as ProductStatus)}><option value="DRAFT">Borrador</option><option value="ACTIVE">Publicado</option><option value="ARCHIVED">Archivado</option></select></label>
                <div className="admin-full-field admin-image-upload">
                  <label>Subir imagen del producto<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" disabled={imageUploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadProductImage(file); event.target.value = '' }} /></label>
                  <small>JPG, PNG, WebP o AVIF · máximo 5 MB. La imagen se guarda en Supabase Storage.</small>
                  {imageUploading && <span className="admin-upload-status">Subiendo imagen...</span>}
                  {form.imageUrl && <div className="admin-image-preview"><img src={form.imageUrl} alt="Vista previa del producto" /><button type="button" className="admin-quiet-button" onClick={() => updateField('imageUrl', '')}>Quitar imagen</button></div>}
                  <label>O pegar URL de imagen<input type="url" placeholder="https://..." value={form.imageUrl} onChange={(event) => updateField('imageUrl', event.target.value)} /></label>
                </div>
                <label className="admin-full-field">Descripción<textarea rows={3} value={form.description} onChange={(event) => updateField('description', event.target.value)} required minLength={5} /></label>
                <label className="admin-full-field">Especificaciones <small>Separadas por coma</small><input value={form.specs} onChange={(event) => updateField('specs', event.target.value)} placeholder="Bluetooth, USB-C, Garantía..." /></label>
                <label>Etiqueta comercial<input value={form.badge} onChange={(event) => updateField('badge', event.target.value)} placeholder="Novedad, Más elegido..." /></label>
                <label className="admin-checkbox"><input type="checkbox" checked={form.featured} onChange={(event) => updateField('featured', event.target.checked)} /> Destacar en la tienda</label>
              </div>
              <div className="admin-form-actions"><button type="button" className="admin-quiet-button" onClick={() => setEditing(null)}>Cancelar</button><button className="admin-primary" disabled={saving || imageUploading}>{imageUploading ? 'Subiendo imagen...' : saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear producto'}</button></div>
            </form>
          ) : null}
          <div className="admin-table-card">
            <div className="admin-table-toolbar"><label className="admin-search">⌕<input placeholder="Buscar por nombre, SKU o categoría..." value={search} onChange={(event) => setSearch(event.target.value)} /></label><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">Todos los estados</option><option value="ACTIVE">Publicados</option><option value="DRAFT">Borradores</option><option value="ARCHIVED">Archivados</option></select></div>
            {loading ? <div className="admin-table-empty">Cargando productos...</div> : visibleProducts.length === 0 ? <div className="admin-table-empty">No hay productos para mostrar.</div> : (
              <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>PRODUCTO</th><th>CATEGORÍA</th><th>PRECIO</th><th>STOCK</th><th>ESTADO</th><th>ACCIONES</th></tr></thead><tbody>
                {visibleProducts.map((product) => <tr key={product.id}><td><div className="admin-product-cell">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span className="admin-product-placeholder">IMG</span>}<div><strong>{product.name}</strong><small>{product.sku}</small></div></div></td><td>{product.category.name}</td><td className="admin-price">{formatPrice(product.priceArs)}</td><td>{product.stock}</td><td><span className={`admin-status ${product.status.toLowerCase()}`}>{product.status === 'ACTIVE' ? 'Publicado' : product.status === 'DRAFT' ? 'Borrador' : 'Archivado'}</span></td><td><div className="admin-row-actions"><button onClick={() => openEditProduct(product)}>Editar</button>{product.status !== 'ARCHIVED' && <button className="archive-action" onClick={() => void archiveProduct(product)}>Archivar</button>}</div></td></tr>)}
              </tbody></table></div>
            )}
            <div className="admin-table-footer">Mostrando {visibleProducts.length} de {products.length} productos</div>
          </div>
          <p className="admin-footnote">Los cambios en productos publicados se reflejan en el catálogo de la tienda. El checkout y los pagos todavía no están habilitados.</p>
        </section>
      </main>
    </div>
  )
}
