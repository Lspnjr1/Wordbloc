// Service Worker for SpellBloc - Offline Support
// Cache version is based on build timestamp - automatically invalidates on deploy
const CACHE_VERSION = '1.0.1';
const CACHE_NAME = `spellbloc-v${CACHE_VERSION}`;

// Core app files for offline support
const urlsToCache = [
    '/',
    '/index.html',
    '/login.html',
    '/game.html',
    '/styles.css',
    '/game.js',
    '/auth-manager.js',
    '/ai-agent.js',
    '/advanced-systems.js',
    '/minipay-integration.js',
    '/manifest.json'
];

// IndexedDB setup for analytics (localStorage not available in SW)
const DB_NAME = 'spellbloc-sw-db';
const DB_VERSION = 1;
const ANALYTICS_STORE = 'pending_analytics';

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(ANALYTICS_STORE)) {
                db.createObjectStore(ANALYTICS_STORE, { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}

// Install event - cache resources
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                // Cache each URL individually to prevent one failure from breaking all caching
                return Promise.allSettled(
                    urlsToCache.map(url =>
                        cache.add(url).catch(err => {
                            console.warn(`Failed to cache ${url}:`, err);
                        })
                    )
                );
            })
            .then(() => {
                // Activate new SW immediately without waiting for old one to finish
                return self.skipWaiting();
            })
    );
});

// Fetch event - stale-while-revalidate for assets, network-first for HTML
self.addEventListener('fetch', (event) => {
    const request = event.request;

    // Only handle GET requests
    if (request.method !== 'GET') {
        return;
    }

    // Skip cross-origin requests
    if (!request.url.startsWith(self.location.origin)) {
        return;
    }

    const url = new URL(request.url);
    const isHTMLRequest = request.headers.get('accept')?.includes('text/html') ||
                          url.pathname.endsWith('.html') ||
                          url.pathname === '/';

    if (isHTMLRequest) {
        // Network-first for HTML - ensures users get latest app on navigation
        event.respondWith(
            fetch(request)
                .then((response) => {
                    // Cache the fresh response
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseClone);
                    });
                    return response;
                })
                .catch(() => {
                    // Offline - serve from cache
                    return caches.match(request);
                })
        );
    } else {
        // Stale-while-revalidate for JS, CSS, and other assets
        event.respondWith(
            caches.match(request).then((cachedResponse) => {
                const fetchPromise = fetch(request).then((networkResponse) => {
                    // Update cache in background
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, networkResponse.clone());
                    });
                    return networkResponse;
                }).catch(() => {
                    // Network failed, cachedResponse will be used
                });

                // Return cached response immediately, or wait for network
                return cachedResponse || fetchPromise;
            })
        );
    }
});

// Activate event - clean up old caches and claim clients
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        // Delete any cache that doesn't match current version
                        if (cacheName.startsWith('spellbloc-') && cacheName !== CACHE_NAME) {
                            console.log('Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                // Take control of all clients immediately
                return self.clients.claim();
            })
    );
});

// Background sync for analytics data
self.addEventListener('sync', (event) => {
    if (event.tag === 'analytics-sync') {
        event.waitUntil(syncAnalyticsData());
    }
});

async function syncAnalyticsData() {
    try {
        // Get pending analytics data from IndexedDB
        const data = await getPendingAnalytics();
        
        // Send to server (placeholder)
        await fetch('/api/analytics', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        
        // Clear pending data after successful sync
        await clearPendingAnalytics();
    } catch (error) {
        console.log('Analytics sync failed, will retry later');
    }
}

// IndexedDB operations for analytics (localStorage not available in SW scope)
async function getPendingAnalytics() {
    try {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(ANALYTICS_STORE, 'readonly');
            const store = transaction.objectStore(ANALYTICS_STORE);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('Failed to get pending analytics:', error);
        return [];
    }
}

async function clearPendingAnalytics() {
    try {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(ANALYTICS_STORE, 'readwrite');
            const store = transaction.objectStore(ANALYTICS_STORE);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('Failed to clear pending analytics:', error);
    }
}

// Helper function to add analytics data (can be called from main thread via postMessage)
async function addPendingAnalytics(data) {
    try {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(ANALYTICS_STORE, 'readwrite');
            const store = transaction.objectStore(ANALYTICS_STORE);
            const request = store.add({ ...data, timestamp: Date.now() });

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('Failed to add analytics:', error);
    }
}

// Handle messages from main thread (for adding analytics)
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'ADD_ANALYTICS') {
        addPendingAnalytics(event.data.payload);
    }
});

// Push notifications for engagement (if user opts in)
self.addEventListener('push', (event) => {
    // Get push data if available
    let notificationData = {
        title: 'SpellBloc Reminder',
        body: 'Time for some spelling practice!'
    };

    if (event.data) {
        try {
            notificationData = { ...notificationData, ...event.data.json() };
        } catch (e) {
            notificationData.body = event.data.text() || notificationData.body;
        }
    }

    const options = {
        body: notificationData.body,
        tag: 'spelling-reminder',
        // Actions without icon references (icons are optional)
        actions: [
            {
                action: 'play',
                title: 'Start Playing'
            },
            {
                action: 'dismiss',
                title: 'Maybe Later'
            }
        ],
        // Vibration pattern for mobile devices
        vibrate: [100, 50, 100],
        // Renotify if same tag
        renotify: true
    };

    event.waitUntil(
        self.registration.showNotification(notificationData.title, options)
    );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    if (event.action === 'play') {
        event.waitUntil(
            clients.openWindow('/')
        );
    }
});