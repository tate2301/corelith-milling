import { describe, it, expect, vi, beforeEach } from "vitest"
import { NotificationSeverity } from "@prisma/client"

const { mockUserFindMany, mockNotificationCreate, mockNotificationRecipientCreateMany, mockUserFindManyPreferences } =
  vi.hoisted(() => ({
    mockUserFindMany: vi.fn(),
    mockNotificationCreate: vi.fn(),
    mockNotificationRecipientCreateMany: vi.fn(),
    mockUserFindManyPreferences: vi.fn(),
  }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: mockUserFindMany,
    },
    notification: {
      create: mockNotificationCreate,
    },
    notificationRecipient: {
      createMany: mockNotificationRecipientCreateMany,
    },
    userNotificationPreference: {
      findMany: mockUserFindManyPreferences,
    },
    // Who hears about what (`NotificationSetting`): no rule, so every kind is on.
    notificationSetting: {
      findMany: vi.fn(async () => []),
    },
  },
}))

import { needsYou } from "@/lib/inbox/describe"

import {
  emitExtensionNotification,
  emitGoldExceptionNotification,
  emitGoldImportFailedNotification,
  emitGoldDispatchReceiptedNotification,
} from "./notifications"

const MANAGER_IDS = ["mgr-1", "mgr-2"]

function setupManagers() {
  mockUserFindMany.mockImplementation(({ where }: { where: { role?: unknown; id?: { in: string[] } } }) => {
    if (where.role) {
      return Promise.resolve(MANAGER_IDS.map((id) => ({ id, isActive: true })))
    }
    if (where.id) {
      return Promise.resolve((where.id.in ?? []).map((id: string) => ({ id })))
    }
    return Promise.resolve([])
  })
  mockUserFindManyPreferences.mockResolvedValue([])
  mockNotificationCreate.mockResolvedValue({ id: "notif-1" })
  mockNotificationRecipientCreateMany.mockResolvedValue({ count: 2 })
}

describe("emitGoldExceptionNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupManagers()
  })

  it("does not notify for non-CRITICAL severity", async () => {
    await emitGoldExceptionNotification({
      companyId: "co-1",
      exceptionId: "exc-1",
      category: "NAME_UNMAPPED",
      severity: "WARN",
    })
    expect(mockNotificationCreate).not.toHaveBeenCalled()
  })

  it("creates CRITICAL notification targeting managers", async () => {
    await emitGoldExceptionNotification({
      companyId: "co-1",
      exceptionId: "exc-2",
      category: "IMPORT_FAILURE",
      severity: "CRITICAL",
      entityType: "GoldPour",
      entityId: "pour-1",
    })
    expect(mockNotificationCreate).toHaveBeenCalledOnce()
    const data = mockNotificationCreate.mock.calls[0][0].data
    expect(data.severity).toBe(NotificationSeverity.CRITICAL)
    expect(data.entityId).toBe("exc-2")
  })
})

describe("emitGoldImportFailedNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupManagers()
  })

  it("creates a WARNING notification", async () => {
    await emitGoldImportFailedNotification({
      companyId: "co-1",
      importId: "imp-1",
      rowsFailed: 3,
      uploaderId: "uploader-99",
    })
    expect(mockNotificationCreate).toHaveBeenCalledOnce()
    const data = mockNotificationCreate.mock.calls[0][0].data
    expect(data.severity).toBe(NotificationSeverity.WARNING)
    expect(data.entityId).toBe("imp-1")
  })
})

describe("emitGoldDispatchReceiptedNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupManagers()
  })

  it("creates an INFO notification for dispatch receipted", async () => {
    await emitGoldDispatchReceiptedNotification({
      companyId: "co-1",
      dispatchId: "dispatch-1",
      receiptId: "receipt-1",
      handedOverById: "mgr-1",
    })
    expect(mockNotificationCreate).toHaveBeenCalledOnce()
    const data = mockNotificationCreate.mock.calls[0][0].data
    expect(data.severity).toBe(NotificationSeverity.INFO)
    expect(data.entityId).toBe("dispatch-1")
  })
})

describe("emitExtensionNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupManagers()
  })

  it("files work handed over under Needs you, with the extension's page, and never tells the actor", async () => {
    await emitExtensionNotification({
      companyId: "co-1",
      recipientIds: ["mgr-1", "mgr-2"],
      actorId: "mgr-2",
      title: "Maize to inspect: MI-261116-01",
      summary: "Chirau farm, 20 000 kg",
      viewPath: "/milling/intake/i-1",
      entityId: "i-1",
      needsYou: true,
    })
    expect(mockNotificationCreate).toHaveBeenCalledOnce()
    const data = mockNotificationCreate.mock.calls[0][0].data
    const payload = JSON.parse(data.payloadJson)
    expect(payload).toEqual({ viewPath: "/milling/intake/i-1", module: "operations", needsYou: true })
    expect(needsYou({ type: data.type, severity: data.severity, payload })).toBe(true)
    expect(mockNotificationRecipientCreateMany.mock.calls[0][0].data.map((row: { userId: string }) => row.userId)).toEqual(["mgr-1"])
  })

  it("keeps news out of Needs you", async () => {
    await emitExtensionNotification({ companyId: "co-1", recipientIds: ["mgr-1"], title: "Released", summary: "x", viewPath: "/milling", entityId: "l-1" })
    const data = mockNotificationCreate.mock.calls[0][0].data
    expect(needsYou({ type: data.type, severity: data.severity, payload: JSON.parse(data.payloadJson) })).toBe(false)
  })

  it("sends nothing when the actor is the only recipient", async () => {
    await emitExtensionNotification({ companyId: "co-1", recipientIds: ["mgr-1"], actorId: "mgr-1", title: "t", summary: "s", viewPath: "/milling", entityId: "e" })
    expect(mockNotificationCreate).not.toHaveBeenCalled()
  })
})
