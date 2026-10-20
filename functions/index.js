const { initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { logger } = require("firebase-functions");
const { onSchedule } = require("firebase-functions/v2/scheduler");

initializeApp();

const TIME_ZONE = "America/Sao_Paulo";

function localDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function scheduledForDay(template, dateParts) {
  if (template.frequency === "DAILY") return true;
  if (template.frequency === "WEEKLY") {
    const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return weekdays[dateParts.weekday] === template.publishWeekday;
  }
  if (template.frequency === "MONTHLY") {
    const lastDayOfMonth = new Date(
      Date.UTC(Number(dateParts.year), Number(dateParts.month), 0),
    ).getUTCDate();
    const configuredDay = Math.min(template.publishDayOfMonth, lastDayOfMonth);
    return Number(dateParts.day) === configuredDay;
  }
  return false;
}

function getDueDate(frequency, dateParts) {
  if (frequency === "DAILY") return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  const dueDate = new Date(Date.UTC(Number(dateParts.year), Number(dateParts.month) - 1, Number(dateParts.day)));
  if (frequency === "WEEKLY") {
    dueDate.setUTCDate(dueDate.getUTCDate() + ((7 - dueDate.getUTCDay()) % 7));
  } else if (frequency === "MONTHLY") {
    dueDate.setUTCDate(1);
    dueDate.setUTCMonth(dueDate.getUTCMonth() + 1);
    dueDate.setUTCDate(0);
  } else {
    throw new Error(`Unsupported checklist frequency: ${frequency}`);
  }
  return `${dueDate.getUTCFullYear()}-${String(dueDate.getUTCMonth() + 1).padStart(2, "0")}-${String(dueDate.getUTCDate()).padStart(2, "0")}`;
}

async function createScheduledAssignment(db, input) {
  const assignmentRef = input.companyRef.collection("checklistAssignments").doc(
    `scheduled-${input.scheduledFor}-${input.templateId}-${input.member.uid}`,
  );
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(assignmentRef);
    if (existing.exists) return;

    transaction.create(assignmentRef, {
      templateId: input.templateId,
      name: input.template.name,
      departmentId: input.template.departmentId,
      items: input.template.items,
      assignedToId: input.member.uid,
      assignedById: input.assignedById,
      status: "PENDING",
      dueAt: input.dueAt,
      frequency: input.template.frequency,
      scheduledFor: input.scheduledFor,
      createdAt: FieldValue.serverTimestamp(),
    });
    for (const item of input.template.items) {
      transaction.create(assignmentRef.collection("results").doc(item.id), {
        status: "PENDING",
        observation: "",
        completedAt: null,
      });
    }
  });
}

exports.publishScheduledChecklists = onSchedule(
  {
    schedule: "5 0 * * *",
    region: "southamerica-east1",
    timeZone: TIME_ZONE,
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    const db = getFirestore();
    const dateParts = localDateParts(new Date());
    const scheduledFor = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
    const templates = await db.collectionGroup("checklistTemplates")
      .where("scheduleEnabled", "==", true)
      .get();

    for (const templateSnapshot of templates.docs) {
      const template = templateSnapshot.data();
      if (!template.active || !scheduledForDay(template, dateParts)) continue;
      if (!["DAILY", "WEEKLY", "MONTHLY"].includes(template.frequency)) {
        logger.error("Scheduled checklist has an unsupported frequency.", {
          templatePath: templateSnapshot.ref.path,
          frequency: template.frequency,
        });
        continue;
      }
      if (!Array.isArray(template.items) || template.items.length === 0 || template.items.length > 450) {
        logger.error("Scheduled checklist has an invalid item count.", { templatePath: templateSnapshot.ref.path });
        continue;
      }
      if (!Array.isArray(template.teamIds) || template.teamIds.length === 0) {
        logger.error("Scheduled checklist has no teams.", { templatePath: templateSnapshot.ref.path });
        continue;
      }

      const companyRef = templateSnapshot.ref.parent.parent;
      if (!companyRef || !companyRef.path.startsWith("companies/")) {
        logger.error("Scheduled checklist is outside a company.", { templatePath: templateSnapshot.ref.path });
        continue;
      }
      const [companySnapshot, membersSnapshot] = await Promise.all([
        companyRef.get(),
        companyRef.collection("members").where("status", "==", "ACTIVE").get(),
      ]);
      const company = companySnapshot.data();
      const assignedById = template.createdById || company?.ownerUid;
      if (!assignedById) {
        logger.error("Scheduled checklist has no responsible creator.", { templatePath: templateSnapshot.ref.path });
        continue;
      }

      const targetRoles = template.responsible === "EMPLOYEE"
        ? ["EMPLOYEE"]
        : template.responsible === "LEADER"
          ? ["LEADER"]
          : ["EMPLOYEE", "LEADER"];
      const recipients = membersSnapshot.docs
        .map((memberSnapshot) => ({ uid: memberSnapshot.id, ...memberSnapshot.data() }))
        .filter((member) =>
          targetRoles.includes(member.role)
          && Array.isArray(member.teamIds)
          && member.teamIds.some((teamId) => template.teamIds.includes(teamId)),
        );
      const dueAt = getDueDate(template.frequency, dateParts);

      for (const member of recipients) {
        await createScheduledAssignment(db, {
          companyRef,
          templateId: templateSnapshot.id,
          template,
          member,
          assignedById,
          scheduledFor,
          dueAt,
        });
      }
      logger.info("Scheduled checklist publication processed.", {
        templatePath: templateSnapshot.ref.path,
        scheduledFor,
        recipientCount: recipients.length,
      });
    }
  },
);

const secureActions = require('./secure-actions');
Object.assign(exports, secureActions);

