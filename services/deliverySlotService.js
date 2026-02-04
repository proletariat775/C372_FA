const DELIVERY_WINDOWS = [
    { key: '09:00-12:00', label: '9:00 AM - 12:00 PM', start: '09:00' },
    { key: '12:00-15:00', label: '12:00 PM - 3:00 PM', start: '12:00' },
    { key: '15:00-18:00', label: '3:00 PM - 6:00 PM', start: '15:00' }
];

const DAYS_AHEAD = 5;

// Update this list to mark fully booked slots (id format: YYYY-MM-DD|HH:MM-HH:MM).
const FULLY_BOOKED_SLOT_IDS = new Set([]);

const pad = (value) => String(value).padStart(2, '0');

const formatDateKey = (date) => {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const formatDateLabel = (date) => date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
});

const buildSlots = (now = new Date()) => {
    const slots = [];

    for (let offset = 0; offset <= DAYS_AHEAD; offset += 1) {
        const date = new Date(now);
        date.setDate(date.getDate() + offset);
        const dateKey = formatDateKey(date);
        const dateLabel = formatDateLabel(date);

        DELIVERY_WINDOWS.forEach((window) => {
            const [hour, minute] = window.start.split(':').map(Number);
            const startTime = new Date(date);
            startTime.setHours(hour, minute, 0, 0);

            const slotId = `${dateKey}|${window.key}`;
            const isPast = startTime.getTime() <= now.getTime();
            const isFullyBooked = FULLY_BOOKED_SLOT_IDS.has(slotId);
            const isAvailable = !isPast && !isFullyBooked;

            slots.push({
                id: slotId,
                date: dateKey,
                dateLabel,
                window: window.key,
                windowLabel: window.label,
                isAvailable,
                reason: isPast ? 'Past time' : (isFullyBooked ? 'Fully booked' : null)
            });
        });
    }

    return slots;
};

const validateSlotSelection = (slotId, deliveryMethod) => {
    if (deliveryMethod !== 'delivery') {
        return { valid: true, slot: null };
    }

    if (!slotId) {
        return { valid: false, message: 'Please select a delivery slot.' };
    }

    const slots = buildSlots();
    const selected = slots.find(slot => slot.id === slotId);
    if (!selected) {
        return { valid: false, message: 'Selected delivery slot is not available.' };
    }

    if (!selected.isAvailable) {
        return { valid: false, message: 'Selected delivery slot is no longer available.' };
    }

    return { valid: true, slot: selected };
};

module.exports = {
    buildSlots,
    validateSlotSelection
};
