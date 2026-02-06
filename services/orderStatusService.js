// Order lifecycle:
// Pickup: processing -> packing -> ready_for_pickup -> completed
// Delivery: processing -> packing -> shipped -> delivered -> completed
// Cancelled/returned are terminal states set by the refund workflow.
const STATUS_FLOW = {
    pickup: ['processing', 'packing', 'ready_for_pickup', 'completed'],
    delivery: ['processing', 'packing', 'shipped', 'delivered', 'completed']
};

const ALL_STATUSES = [
    'processing',
    'packing',
    'ready_for_pickup',
    'shipped',
    'delivered',
    'completed',
    'cancelled',
    'returned'
];

const LEGACY_STATUS_MAP = {
    pending: 'processing',
    packed: 'packing',
    refunded: 'returned'
};

const toKey = (value) => String(value || '').trim().toLowerCase();

const mapLegacyStatus = (value) => {
    const key = toKey(value);
    return LEGACY_STATUS_MAP[key] || key;
};

const resolveStatus = (value) => {
    const key = mapLegacyStatus(value);
    return ALL_STATUSES.includes(key) ? key : null;
};

const resolveDeliveryMethod = (value) => (toKey(value) === 'pickup' ? 'pickup' : 'delivery');

const getFlowForMethod = (method) => (resolveDeliveryMethod(method) === 'pickup' ? STATUS_FLOW.pickup : STATUS_FLOW.delivery);

const getStatusIndex = (status, method) => {
    const flow = getFlowForMethod(method);
    const key = mapLegacyStatus(status);
    return flow.indexOf(key);
};

const getNextStatus = (currentStatus, method) => {
    const flow = getFlowForMethod(method);
    const currentKey = mapLegacyStatus(currentStatus);
    if (currentKey === 'cancelled' || currentKey === 'returned') {
        return null;
    }
    const currentIndex = getStatusIndex(currentStatus, method);
    if (currentIndex < 0) {
        return flow[0] || null;
    }
    if (currentIndex >= flow.length - 1) {
        return null;
    }
    return flow[currentIndex + 1];
};

const canTransition = (currentStatus, nextStatus, method) => {
    const flow = getFlowForMethod(method);
    const currentIndex = getStatusIndex(currentStatus, method);
    const nextKey = mapLegacyStatus(nextStatus);
    const nextIndex = flow.indexOf(nextKey);

    if (nextIndex < 0) {
        return false;
    }
    if (currentIndex < 0) {
        return nextIndex === 0;
    }
    return nextIndex === currentIndex || nextIndex === currentIndex + 1;
};

const isCancelledStatus = (status) => mapLegacyStatus(status) === 'cancelled';
const isReturnedStatus = (status) => mapLegacyStatus(status) === 'returned';
const isCompletedStatus = (status) => {
    const key = mapLegacyStatus(status);
    return key === 'completed' || key === 'delivered';
};
const isTerminalStatus = (status) => {
    const key = mapLegacyStatus(status);
    return key === 'completed' || key === 'cancelled' || key === 'returned';
};

module.exports = {
    STATUS_FLOW,
    ALL_STATUSES,
    mapLegacyStatus,
    resolveStatus,
    resolveDeliveryMethod,
    getFlowForMethod,
    getStatusIndex,
    getNextStatus,
    canTransition,
    isCancelledStatus,
    isReturnedStatus,
    isCompletedStatus,
    isTerminalStatus
};
