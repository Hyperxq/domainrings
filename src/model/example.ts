import type { Diagram } from './schema'

export const EXAMPLE_DIAGRAM: Diagram = {
  version: 1,
  kind: 'hexagonal',
  title: 'Chat feedback slice',
  subtitle: 'Ports & adapters, one use case end to end',
  domain: [
    { id: 'd-feedback', name: 'Feedback', type: 'aggregate' },
    { id: 'd-rating', name: 'FeedbackRating', type: 'valueObject', parentId: 'd-feedback' },
    { id: 'd-email', name: 'AuthorEmail', type: 'valueObject', parentId: 'd-feedback' },
  ],
  useCases: [
    { id: 'uc-submit', name: 'SubmitChatFeedback', note: 'execute(cmd): Promise<void>\nvalidate, save, notify support' },
  ],
  ports: [
    { id: 'p-submit', name: 'submitChatFeedback', side: 'driving', useCaseId: 'uc-submit', note: '(command)' },
    { id: 'p-repo', name: 'FeedbackRepository', side: 'driven', useCaseId: 'uc-submit' },
    { id: 'p-notify', name: 'SupportNotifier', side: 'driven', useCaseId: 'uc-submit' },
    { id: 'p-users', name: 'UserDirectory', side: 'driven', useCaseId: 'uc-submit' },
  ],
  adapters: [
    { id: 'a-http', name: 'feedback.routes/handler/schema', portId: 'p-submit', note: 'HTTP → command' },
    { id: 'a-knex', name: 'KnexFeedbackRepository', portId: 'p-repo' },
    { id: 'a-email', name: 'EmailSupportNotifier', portId: 'p-notify' },
    { id: 'a-legacy', name: 'LegacyUserDirectory · ACL', portId: 'p-users' },
  ],
  actors: [{ id: 'act-frontend', name: 'Frontend', adapterId: 'a-http', note: 'chat widget' }],
  externals: [
    { id: 'ext-pg', name: 'Postgres', adapterId: 'a-knex', note: 'chat_feedback' },
    { id: 'ext-mailgun', name: 'Mailgun', adapterId: 'a-email', note: 'support inbox' },
    { id: 'ext-legacy', name: 'model-user (legacy)', adapterId: 'a-legacy', note: 'model/user.js' },
  ],
  composition: { name: 'composition.ts', note: 'wires adapters into the use case' },
}

const withoutParents = (d: Diagram): Diagram => ({ ...d, domain: d.domain.map(({ parentId: _parentId, ...item }) => item) })
const withoutNotes = <T extends { note?: string }>(items: T[]): T[] => items.map(({ note: _note, ...item }) => item as T)

/**
 * Earlier versions of the seed, as they were written to storage. An autosave that still equals one of them was
 * never edited, so it is upgraded to the current seed. Bump SEED_VERSION and append here when the seed changes.
 */
export const SEED_VERSION = 4
// Each retired seed is derived from the one after it, so history stays readable as a list of differences.
const v3: Diagram = {
  ...EXAMPLE_DIAGRAM,
  domain: EXAMPLE_DIAGRAM.domain.map((i) => (i.id === 'd-feedback' ? { ...i, type: 'entity' as const } : i)),
}
const v2 = withoutParents(v3)
const v1: Diagram = {
  ...v2,
  useCases: withoutNotes(v2.useCases),
  ports: withoutNotes(v2.ports),
  adapters: withoutNotes(v2.adapters),
  actors: withoutNotes(v2.actors),
  externals: withoutNotes(v2.externals),
  composition: { name: 'composition.ts', note: 'Wires adapters into the use case' },
}
export const RETIRED_SEEDS: Diagram[] = [v1, v2, v3]

export const STRESS_DIAGRAM: Diagram = {
  version: 1,
  kind: 'hexagonal',
  title: 'Stress test',
  subtitle: 'Ten domain items, three use cases (one beside its port), ports on all six walls',
  domain: [
    { id: 'g-order', name: 'Order', type: 'aggregate' },
    { id: 'e-line', name: 'OrderLine', type: 'entity', parentId: 'g-order' },
    { id: 'v-money', name: 'Money', type: 'valueObject', parentId: 'e-line' },
    { id: 'v-qty', name: 'Quantity', type: 'valueObject', parentId: 'e-line' },
    { id: 'v-address', name: 'ShippingAddress', type: 'valueObject', parentId: 'g-order' },
    { id: 'g-customer', name: 'Customer', type: 'aggregate' },
    { id: 'e-account', name: 'Account', type: 'entity', parentId: 'g-customer' },
    { id: 'v-email', name: 'Email', type: 'valueObject', parentId: 'e-account' },
    { id: 'e-loyalty', name: 'LoyaltyCard', type: 'entity', parentId: 'g-customer' },
    { id: 'v-points', name: 'Points', type: 'valueObject', parentId: 'e-loyalty' },
  ],
  useCases: [
    { id: 'uc-place', name: 'PlaceOrder', note: 'execute(cmd): Promise<OrderId>\nprice, reserve stock, charge' },
    { id: 'uc-cancel', name: 'CancelOrder', note: 'execute(cmd): Promise<void>\nrelease stock, notify' },
    { id: 'uc-earn', name: 'EarnPoints', placement: 'nw', note: 'execute(evt): Promise<void>\ncredit the loyalty card' },
  ],
  ports: [
    { id: 'p-orders', name: 'ordersApi', side: 'driving', wall: 'w', useCaseId: 'uc-place', note: '(command)' },
    { id: 'p-events', name: 'loyaltyEvents', side: 'driving', wall: 'nw', useCaseId: 'uc-earn', note: '(event)' },
    { id: 'p-admin', name: 'adminCommands', side: 'driving', wall: 'sw', useCaseId: 'uc-cancel', note: '(command)' },
    { id: 'p-order-repo', name: 'OrderRepository', side: 'driven', wall: 'ne', useCaseId: 'uc-place' },
    { id: 'p-payments', name: 'PaymentGateway', side: 'driven', wall: 'ne', useCaseId: 'uc-place' },
    { id: 'p-stock', name: 'StockLevels', side: 'driven', wall: 'e', useCaseId: 'uc-place' },
    { id: 'p-notify', name: 'CustomerNotifier', side: 'driven', wall: 'e', useCaseId: 'uc-cancel' },
    { id: 'p-customer-repo', name: 'CustomerRepository', side: 'driven', wall: 'se', useCaseId: 'uc-earn' },
    { id: 'p-clock', name: 'Clock', side: 'driven', wall: 'se', useCaseId: 'uc-earn' },
  ],
  adapters: [
    { id: 'a-rest', name: 'orders.routes', portId: 'p-orders', note: 'HTTP → command' },
    { id: 'a-queue', name: 'loyalty.consumer', portId: 'p-events', note: 'event → command' },
    { id: 'a-admin', name: 'admin.cli', portId: 'p-admin', note: 'CLI → command' },
    { id: 'a-order-repo', name: 'KnexOrderRepository', portId: 'p-order-repo' },
    { id: 'a-stripe', name: 'StripePaymentGateway', portId: 'p-payments' },
    { id: 'a-stock', name: 'WarehouseStockClient', portId: 'p-stock' },
    { id: 'a-ses', name: 'SesCustomerNotifier', portId: 'p-notify' },
    { id: 'a-customer-repo', name: 'KnexCustomerRepository', portId: 'p-customer-repo' },
    { id: 'a-clock', name: 'SystemClock', portId: 'p-clock' },
  ],
  actors: [
    { id: 'act-web', name: 'Web shop', adapterId: 'a-rest', note: 'checkout' },
    { id: 'act-bus', name: 'Event bus', adapterId: 'a-queue', note: 'order.paid' },
    { id: 'act-ops', name: 'Ops', adapterId: 'a-admin', note: 'support desk' },
  ],
  externals: [
    { id: 'ext-orders-db', name: 'Postgres', adapterId: 'a-order-repo', note: 'orders' },
    { id: 'ext-stripe', name: 'Stripe', adapterId: 'a-stripe', note: 'charges API' },
    { id: 'ext-warehouse', name: 'Warehouse API', adapterId: 'a-stock', note: 'REST' },
    { id: 'ext-ses', name: 'AWS SES', adapterId: 'a-ses', note: 'email' },
    { id: 'ext-customers-db', name: 'Postgres', adapterId: 'a-customer-repo', note: 'customers' },
  ],
  composition: { name: 'composition.ts', note: 'wires adapters into the use cases' },
}

export const EXAMPLES = [
  { id: 'feedback', label: 'Chat feedback slice', diagram: EXAMPLE_DIAGRAM },
  { id: 'stress', label: 'Stress test', diagram: STRESS_DIAGRAM },
] as const
