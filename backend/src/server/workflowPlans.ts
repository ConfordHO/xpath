import type {
  CytologyCase,
  Database,
  Order,
  OrderItem,
  OrderItemStatus,
  OrderWorkflowDependency,
  OrderWorkflowItemPlan,
  OrderWorkflowItemSummary,
  OrderWorkflowModule,
  OrderWorkflowPlan,
  OrderWorkflowRouteGuide,
  OrderWorkflowSpecimenLink,
  OrderWorkflowStageId,
  OrderWorkflowStageState,
} from "../types.js";

const stageMeta: Record<
  OrderWorkflowStageId,
  { label: string; description: string; module: OrderWorkflowModule }
> = {
  accessioning: {
    label: "Accessioning",
    description: "Create the accession and specimen labels for tissue processing.",
    module: "histology",
  },
  grossing: {
    label: "Grossing",
    description: "Record the gross description and define block counts.",
    module: "histology",
  },
  processing: {
    label: "Processing",
    description: "Run tissue processing before embedding.",
    module: "histology",
  },
  embedding: {
    label: "Embedding",
    description: "Embed processed tissue blocks in paraffin.",
    module: "histology",
  },
  sectioning: {
    label: "Sectioning",
    description: "Cut slides from the prepared histology blocks.",
    module: "histology",
  },
  staining: {
    label: "Staining",
    description: "Stain the prepared slides before review or downstream testing.",
    module: "histology",
  },
  cytology_case: {
    label: "Cytology case setup",
    description: "Create the cytology case and route it to the proper preparation type.",
    module: "cytology",
  },
  cytology_screening: {
    label: "Cytotechnologist screening",
    description: "Record adequacy criteria, screening notes, and escalation before QC.",
    module: "cytology",
  },
  cytology_qc: {
    label: "Cytology QC",
    description: "Capture route-specific QC before the case can move to review.",
    module: "cytology",
  },
  ihc: {
    label: "IHC / special stains",
    description: "Record IHC or special stain work before sign-out.",
    module: "ihc",
  },
  analyzer_run: {
    label: "Analyzer run",
    description: "Complete the analyzer or biomarker run for this order.",
    module: "analyzer",
  },
  molecular_sendout: {
    label: "Molecular send-out",
    description: "Dispatch the molecular / NGS sample and capture completion.",
    module: "molecular",
  },
  pathologist_review: {
    label: "Pathologist review",
    description: "Move the case into the pathologist review queue.",
    module: "pathology",
  },
  report_signout: {
    label: "Report sign-out",
    description: "Complete the pathology report and sign the final interpretation.",
    module: "pathology",
  },
  result_release: {
    label: "Result release",
    description: "Release the signed report to portals and communication channels.",
    module: "pathology",
  },
};

const cytologyWorkflow: OrderWorkflowStageId[] = [
  "cytology_case",
  "cytology_screening",
  "cytology_qc",
  "pathologist_review",
  "report_signout",
  "result_release",
];
const histologyWorkflow: OrderWorkflowStageId[] = [
  "accessioning",
  "grossing",
  "processing",
  "embedding",
  "sectioning",
  "staining",
  "pathologist_review",
  "report_signout",
  "result_release",
];
const ihcWorkflow: OrderWorkflowStageId[] = [
  "accessioning",
  "grossing",
  "processing",
  "embedding",
  "sectioning",
  "staining",
  "ihc",
  "pathologist_review",
  "report_signout",
  "result_release",
];
const consultationWorkflow: OrderWorkflowStageId[] = ["pathologist_review", "report_signout", "result_release"];
const molecularSendoutWorkflow: OrderWorkflowStageId[] = [
  "molecular_sendout",
  "pathologist_review",
  "report_signout",
  "result_release",
];

const workflowByTestId: Record<string, OrderWorkflowStageId[]> = {
  "test-cy-f-001": cytologyWorkflow,
  "test-cy-f-002": cytologyWorkflow,
  "test-he-b-002": cytologyWorkflow,
  "test-he-bm-003": cytologyWorkflow,
  "test-he-bm-001": ["analyzer_run", "pathologist_review", "report_signout", "result_release"],
  "test-hi-t-001": histologyWorkflow,
  "test-hi-t-002": histologyWorkflow,
  "test-hi-t-003": histologyWorkflow,
  "test-hi-t-004": histologyWorkflow,
  "test-hs-t-005": ihcWorkflow,
  "test-im-t-01": ihcWorkflow,
  "test-im-t-02": ihcWorkflow,
  "test-im-t-03": ihcWorkflow,
  "test-im-t-04": ihcWorkflow,
  "test-im-t-05": ihcWorkflow,
  "test-im-t-06": ihcWorkflow,
  "test-bt-b-001": ["analyzer_run", "pathologist_review", "report_signout", "result_release"],
  "test-co-t-01": consultationWorkflow,
  "test-co-t-02": consultationWorkflow,
  "test-co-n-03": consultationWorkflow,
  "test-pk-t-001": ihcWorkflow,
  "test-pk-bm-002": [
    "accessioning",
    "grossing",
    "processing",
    "embedding",
    "sectioning",
    "staining",
    "cytology_case",
    "cytology_screening",
    "cytology_qc",
    "ihc",
    "pathologist_review",
    "report_signout",
    "result_release",
  ],
  "test-mo-b-001": molecularSendoutWorkflow,
  "test-mo-t-002": molecularSendoutWorkflow,
  "test-mo-t-003": molecularSendoutWorkflow,
  "test-mo-b-004": ["molecular_sendout", "analyzer_run", "pathologist_review", "report_signout", "result_release"],
  "test-mo-b-05": molecularSendoutWorkflow,
  "test-mo-s-06": molecularSendoutWorkflow,
};

function uniqueOrdered(values: OrderWorkflowStageId[]) {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}

function getCytologyCase(db: Database, orderId: string) {
  return db.cytologyCases.find((entry) => entry.orderId === orderId) ?? null;
}

function cytologyQcPassed(entry: CytologyCase | null) {
  if (!entry) {
    return false;
  }
  if (entry.qcStatus === "pass") {
    return true;
  }
  return entry.status === "complete";
}

function cytologyScreeningComplete(entry: CytologyCase | null) {
  return Boolean(
    entry &&
      ["adequate", "escalated"].includes(entry.screeningStatus ?? "") &&
      ["satisfactory", "limited"].includes(entry.adequacyStatus ?? ""),
  );
}

function getHistologyArtifacts(db: Database, orderId: string) {
  const accession = db.accessions.find((entry) => entry.orderId === orderId) ?? null;
  const ihcDone = Boolean(
    accession?.blocks.some((block) => block.slides.some((slide) => slide.ihcEntries.length > 0)),
  );
  return { accession, ihcDone };
}

function getReport(db: Database, orderId: string) {
  return db.reports.find((entry) => entry.orderId === orderId) ?? null;
}

function routeStagesForTest(testTypeId: string) {
  return workflowByTestId[testTypeId] ?? ["pathologist_review", "report_signout", "result_release"];
}

function terminalOrderItemStatus(status: OrderItemStatus) {
  return ["released", "cancelled", "resolved"].includes(status);
}

function isHistologyStage(stageId: OrderWorkflowStageId) {
  return ["accessioning", "grossing", "processing", "embedding", "sectioning", "staining"].includes(stageId);
}

function itemTerminalStatusFromOrder(order: Order): OrderItemStatus | null {
  if (order.status === "cancelled") return "cancelled";
  if (order.status === "released") return "released";
  return null;
}

function getOrderItemRecords(db: Database, order: Order): OrderItem[] {
  const persisted = db.orderItems
    .filter((item) => item.orderId === order._id)
    .sort((a, b) => a.itemNumber - b.itemNumber);
  if (persisted.length === order.testTypeIds.length) {
    return persisted;
  }

  return order.testTypeIds.map((testTypeId, index) => ({
    _id: `${order._id}:item:${index + 1}`,
    orderId: order._id,
    testTypeId,
    itemNumber: index + 1,
    status: itemTerminalStatusFromOrder(order) ?? (order.status === "completed" ? "completed" : "pending"),
    resolvedReason: null,
    resolvedBy: null,
    resolvedAt: null,
    cancelledReason: null,
    cancelledBy: null,
    cancelledAt: null,
    releasedAt: order.status === "released" ? order.releasedAt ?? order.updatedAt : null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  }));
}

function histologyBlockAvailable(db: Database, orderId: string) {
  const accession = db.accessions.find((entry) => entry.orderId === orderId) ?? null;
  return Boolean(
    accession?.blocks.some(
      (block) => block.embeddedAt && (block.sectionedAt || block.slides.length > 0),
    ),
  );
}

function getSpecimenLinks(
  db: Database,
  order: Order,
  orderItem: OrderItem,
): OrderWorkflowSpecimenLink[] {
  const assignments = db.specimenAssignments.filter(
    (assignment) =>
      assignment.orderId === order._id && assignment.orderItemIds.includes(orderItem._id),
  );
  const directSample = db.samples.find((sample) => sample.orderId === order._id) ?? null;
  const fallbackAssignments =
    assignments.length || !directSample
      ? assignments
      : [
          {
            _id: `${order._id}:${directSample._id}:assignment:fallback`,
            specimenId: directSample._id,
            orderId: order._id,
            orderItemIds: getOrderItemRecords(db, order).map((item) => item._id),
            accessionId: directSample.accessionId,
            sampleId: directSample._id,
            assignmentType: order.testTypeIds.length > 1 ? ("shared" as const) : ("dedicated" as const),
            createdAt: directSample.createdAt,
            updatedAt: directSample.updatedAt,
          },
        ];

  return fallbackAssignments.map((assignment) => {
    const sample = db.samples.find((entry) => entry._id === assignment.sampleId) ?? directSample;
    const accession = db.accessions.find((entry) => entry._id === assignment.accessionId) ?? null;
    return {
      specimenId: assignment.specimenId,
      accessionId: assignment.accessionId ?? accession?._id ?? null,
      sampleId: assignment.sampleId ?? sample?._id ?? null,
      label: sample?.label ?? accession?.accessionId ?? assignment.specimenId,
      sharedWithOrderItemIds: assignment.orderItemIds,
    };
  });
}

function getItemDependencies(
  db: Database,
  order: Order,
  orderItem: OrderItem,
  stages: OrderWorkflowStageId[],
  currentStageId?: OrderWorkflowStageId | null,
): OrderWorkflowDependency[] {
  if (!stages.includes("ihc")) {
    return [];
  }

  const allItems = getOrderItemRecords(db, order);
  const histologySourceItemIds = allItems
    .filter(
      (item) =>
        item._id !== orderItem._id &&
        routeStagesForTest(item.testTypeId).some((stageId) => isHistologyStage(stageId)),
    )
    .map((item) => item._id);
  const satisfied = histologyBlockAvailable(db, order._id);
  const status: OrderWorkflowDependency["status"] = satisfied
    ? "satisfied"
    : currentStageId === "ihc"
      ? "blocked"
      : "pending";

  return [
    {
      code: "histology_block_available",
      label: "Histology block availability",
      status,
      message: satisfied
        ? "A histology block/slide is available for downstream IHC."
        : "IHC is waiting for an embedded and sectioned histology block or slide from the shared specimen.",
      dependsOnOrderItemIds: histologySourceItemIds,
      satisfiedByStageId: "sectioning",
    },
  ];
}

export function getRequiredWorkflowStages(order: Order) {
  const collected = uniqueOrdered(
    order.testTypeIds.flatMap((testTypeId) => routeStagesForTest(testTypeId)),
  );

  if (!collected.includes("pathologist_review")) {
    collected.push("pathologist_review");
  }
  if (!collected.includes("report_signout")) {
    collected.push("report_signout");
  }
  if (!collected.includes("result_release")) {
    collected.push("result_release");
  }

  return collected;
}

export function orderHasHistologyWorkflow(order: Order) {
  return getRequiredWorkflowStages(order).some((stageId) =>
    ["accessioning", "grossing", "processing", "embedding", "sectioning", "staining"].includes(
      stageId,
    ),
  );
}

export function orderHasCytologyWorkflow(order: Order) {
  return getRequiredWorkflowStages(order).some((stageId) =>
    ["cytology_case", "cytology_screening", "cytology_qc"].includes(stageId),
  );
}

export function orderRequiresIhcWorkflow(order: Order) {
  return getRequiredWorkflowStages(order).includes("ihc");
}

export function orderRequiresTechnicianWorkflow(order: Order) {
  return getRequiredWorkflowStages(order).some((stageId) => stageMeta[stageId].module !== "pathology");
}

export function inferCytologyCaseDefaults(db: Database, order: Order) {
  const tests = db.testTypes.filter((entry) => order.testTypeIds.includes(entry._id));
  const specimenType =
    order.requisitionForm?.specimenType?.trim() ||
    (order.testTypeIds.includes("test-cy-f-002")
      ? "Cervical smear"
      : order.testTypeIds.includes("test-cy-f-001")
        ? "Body fluid specimen"
        : order.testTypeIds.includes("test-he-b-002")
          ? "Peripheral blood smear"
          : order.testTypeIds.includes("test-he-bm-003") ||
              order.testTypeIds.includes("test-pk-bm-002")
            ? "Bone marrow aspirate"
            : "Cytology specimen");

  return {
    specimenType,
    routeType: order.testTypeIds.includes("test-cy-f-002") ? ("gyn" as const) : ("non_gyn" as const),
    preparationType: order.testTypeIds.includes("test-cy-f-002")
      ? ("liquid_based" as const)
      : order.testTypeIds.includes("test-cy-f-001")
        ? ("cell_block" as const)
        : ("smear" as const),
    remarks: `Auto-routed from ${tests.map((entry) => entry.code).join(", ")} workflow.`,
  };
}

export function inferAnalyzerRunType(order: Order) {
  if (order.testTypeIds.includes("test-mo-b-004")) {
    return "bcr_abl_analysis";
  }
  if (order.testTypeIds.includes("test-bt-b-001")) {
    return "tumor_marker_panel";
  }
  if (order.testTypeIds.includes("test-he-bm-001")) {
    return "flow_cytometry_facs";
  }
  return "analyzer_run";
}

export function inferMolecularRunType(order: Order) {
  if (order.testTypeIds.includes("test-mo-s-06")) {
    return "paternity_sendout";
  }
  if (order.testTypeIds.some((id) => ["test-mo-b-001", "test-mo-t-002", "test-mo-t-003", "test-mo-b-05"].includes(id))) {
    return "molecular_panel_sendout";
  }
  return "molecular_sendout";
}

function hasAnalyzerRun(db: Database, order: Order) {
  const expected = inferAnalyzerRunType(order);
  return db.instrumentRuns.some(
    (entry) => entry.orderId === order._id && entry.runType === expected && entry.qcStatus !== "fail",
  );
}

function hasAnalyzerRunForTest(db: Database, order: Order, testTypeId?: string | null) {
  if (!testTypeId) {
    return hasAnalyzerRun(db, order);
  }
  return hasAnalyzerRun(db, { ...order, testTypeIds: [testTypeId] });
}

function hasMolecularSendout(db: Database, order: Order) {
  const expected = inferMolecularRunType(order);
  return db.instrumentRuns.some(
    (entry) => entry.orderId === order._id && entry.runType === expected && entry.qcStatus !== "fail",
  );
}

function hasMolecularSendoutForTest(db: Database, order: Order, testTypeId?: string | null) {
  if (!testTypeId) {
    return hasMolecularSendout(db, order);
  }
  return hasMolecularSendout(db, { ...order, testTypeIds: [testTypeId] });
}

function isStageComplete(
  db: Database,
  order: Order,
  stageId: OrderWorkflowStageId,
  testTypeId?: string | null,
) {
  const { accession, ihcDone } = getHistologyArtifacts(db, order._id);
  const cytologyCase = getCytologyCase(db, order._id);
  const report = getReport(db, order._id);

  switch (stageId) {
    case "accessioning":
      return Boolean(accession);
    case "grossing":
      return Boolean(accession?.grossedAt);
    case "processing":
      return Boolean(accession?.processedAt);
    case "embedding":
      return Boolean(accession?.embeddedAt);
    case "sectioning":
      return Boolean(accession?.sectionedAt);
    case "staining":
      return Boolean(accession?.stainedAt);
    case "cytology_case":
      return Boolean(cytologyCase);
    case "cytology_screening":
      return cytologyScreeningComplete(cytologyCase);
    case "cytology_qc":
      return cytologyQcPassed(cytologyCase);
    case "ihc":
      return ihcDone;
    case "analyzer_run":
      return hasAnalyzerRunForTest(db, order, testTypeId);
    case "molecular_sendout":
      return hasMolecularSendoutForTest(db, order, testTypeId);
    case "pathologist_review":
      return ["review", "completed", "released"].includes(order.status);
    case "report_signout":
      return Boolean(report?.lockedAt) || ["completed", "released"].includes(order.status);
    case "result_release":
      return order.status === "released";
    default:
      return false;
  }
}

function getRouteTags(stageIds: OrderWorkflowStageId[]) {
  const modules = uniqueOrdered(stageIds)
    .map((stageId) => stageMeta[stageId].module)
    .filter((value, index, all) => all.indexOf(value) === index);

  const labels: Record<OrderWorkflowModule, string> = {
    histology: "Histology",
    cytology: "Cytology",
    ihc: "IHC",
    analyzer: "Analyzer",
    molecular: "Molecular",
    pathology: "Pathology",
  };

  return modules.map((module) => labels[module]);
}

export function describeOrderWorkflowRoutes(db: Database, order: Order): OrderWorkflowRouteGuide[] {
  return getOrderWorkflowItemPlans(db, order).map((plan) => ({
    key: `${order._id}:${plan.orderItemId}`,
    orderItemId: plan.orderItemId,
    testTypeId: plan.testTypeId,
    testCode: plan.testCode,
    testName: plan.testName,
    category: plan.category,
    status: plan.status,
    stages: plan.stages.map((stage) => stage.id),
    routeTags: plan.routeTags,
    requiresAccession: plan.stages.some((stage) => stage.id === "accessioning"),
    primaryModule: plan.stages[0]?.module ?? "pathology",
    dependencies: plan.dependencies,
    specimenLinks: plan.specimenLinks,
  }));
}

function currentStageForItem(
  db: Database,
  order: Order,
  orderItem: OrderItem,
  stages: OrderWorkflowStageId[],
) {
  let currentAssigned = false;
  const terminalStatus = itemTerminalStatusFromOrder(order) ?? orderItem.status;
  if (terminalOrderItemStatus(terminalStatus) || terminalStatus === "completed") {
    return {
      stages: stages.map((stageId) => ({
        id: stageId,
        label: stageMeta[stageId].label,
        description: stageMeta[stageId].description,
        module: stageMeta[stageId].module,
        status: "complete" as const,
      })),
      current: null,
    };
  }

  const stageStates: OrderWorkflowStageState[] = stages.map((stageId) => {
    const complete = isStageComplete(db, order, stageId, orderItem.testTypeId);
    const blocked = !complete && stageId === "ihc" && !histologyBlockAvailable(db, order._id);
    const status: OrderWorkflowStageState["status"] = complete
      ? "complete"
      : !currentAssigned
        ? ((currentAssigned = true), blocked ? "blocked" : "current")
        : "pending";
    return {
      id: stageId,
      label: stageMeta[stageId].label,
      description: stageMeta[stageId].description,
      module: stageMeta[stageId].module,
      status,
    };
  });

  return {
    stages: stageStates,
    current:
      stageStates.find((stage) => stage.status === "current" || stage.status === "blocked") ??
      null,
  };
}

function inferOrderItemStatus(
  order: Order,
  orderItem: OrderItem,
  stages: OrderWorkflowStageState[],
  dependencies: OrderWorkflowDependency[],
): OrderItemStatus {
  const terminalStatus = itemTerminalStatusFromOrder(order);
  if (terminalStatus) return terminalStatus;
  if (terminalOrderItemStatus(orderItem.status)) return orderItem.status;
  if (order.status === "completed" || orderItem.status === "completed") return "completed";
  if (stages.every((stage) => stage.status === "complete")) return "released";
  if (stages.some((stage) => stage.id === "result_release" && stage.status === "complete")) {
    return "released";
  }
  if (stages.some((stage) => stage.id === "report_signout" && stage.status === "complete")) {
    return "completed";
  }
  if (
    stages.some((stage) => stage.status === "blocked") ||
    dependencies.some((dependency) => dependency.status === "blocked")
  ) {
    return "blocked";
  }
  if (stages.some((stage) => stage.status === "complete") || ["in_progress", "review"].includes(order.status)) {
    return "in_progress";
  }
  return "pending";
}

function summarizeItemPlans(itemPlans: OrderWorkflowItemPlan[]): OrderWorkflowItemSummary {
  return itemPlans.reduce<OrderWorkflowItemSummary>(
    (summary, item) => {
      switch (item.status) {
        case "pending":
          summary.pending += 1;
          break;
        case "blocked":
          summary.blocked += 1;
          break;
        case "in_progress":
          summary.inProgress += 1;
          break;
        case "completed":
          summary.completed += 1;
          break;
        case "released":
          summary.released += 1;
          break;
        case "cancelled":
          summary.cancelled += 1;
          break;
        case "resolved":
          summary.resolved += 1;
          break;
      }
      return summary;
    },
    {
      pending: 0,
      blocked: 0,
      inProgress: 0,
      completed: 0,
      released: 0,
      cancelled: 0,
      resolved: 0,
    },
  );
}

export function getOrderWorkflowItemPlans(db: Database, order: Order): OrderWorkflowItemPlan[] {
  return getOrderItemRecords(db, order)
    .map((orderItem) => {
      const testType = db.testTypes.find((entry) => entry._id === orderItem.testTypeId);
      if (!testType) {
        return null;
      }
      const routeStages = routeStagesForTest(orderItem.testTypeId);
      const itemStageState = currentStageForItem(db, order, orderItem, routeStages);
      const dependencies = getItemDependencies(
        db,
        order,
        orderItem,
        routeStages,
        itemStageState.current?.id ?? null,
      );
      const stages = itemStageState.stages.map((stage) =>
        stage.id === "ihc" && dependencies.some((dependency) => dependency.status === "blocked")
          ? { ...stage, status: "blocked" as const }
          : stage,
      );
      const current =
        stages.find((stage) => stage.status === "current" || stage.status === "blocked") ?? null;
      const status = inferOrderItemStatus(order, orderItem, stages, dependencies);
      return {
        orderItemId: orderItem._id,
        itemNumber: orderItem.itemNumber,
        testTypeId: testType._id,
        testCode: testType.code,
        testName: testType.name,
        category: testType.category,
        status,
        terminal: terminalOrderItemStatus(status),
        routeTags: getRouteTags(routeStages),
        nextStageId: terminalOrderItemStatus(status) ? null : current?.id ?? null,
        nextStageLabel: terminalOrderItemStatus(status) ? null : current?.label ?? null,
        nextModule: terminalOrderItemStatus(status) ? null : current?.module ?? null,
        reviewReady: current?.id === "pathologist_review",
        dependencies,
        specimenLinks: getSpecimenLinks(db, order, orderItem),
        stages,
      } satisfies OrderWorkflowItemPlan;
    })
    .filter((entry): entry is OrderWorkflowItemPlan => Boolean(entry));
}

export function orderWorkflowTerminalForCompletion(db: Database, order: Order) {
  return getOrderWorkflowItemPlans(db, order).every((item) =>
    ["completed", "released", "cancelled", "resolved"].includes(item.status) ||
    item.nextStageId === "report_signout",
  );
}

export function orderWorkflowTerminalForRelease(db: Database, order: Order) {
  return getOrderWorkflowItemPlans(db, order).every((item) =>
    ["completed", "released", "cancelled", "resolved"].includes(item.status),
  );
}

export function markOrderItemsReleased(db: Database, order: Order, timestamp: string) {
  for (const item of db.orderItems.filter((entry) => entry.orderId === order._id)) {
    if (item.status === "cancelled" || item.status === "resolved") {
      continue;
    }
    item.status = "released";
    item.releasedAt = item.releasedAt ?? timestamp;
    item.updatedAt = timestamp;
  }
}

export function markOrderItemsCompleted(db: Database, order: Order, timestamp: string) {
  for (const item of db.orderItems.filter((entry) => entry.orderId === order._id)) {
    if (terminalOrderItemStatus(item.status)) {
      continue;
    }
    item.status = "completed";
    item.updatedAt = timestamp;
  }
}

export function getWorkflowItemDashboard(db: Database) {
  const allPlans = db.orders.flatMap((order) => getOrderWorkflowItemPlans(db, order));
  return {
    total: allPlans.length,
    ...summarizeItemPlans(allPlans),
    pendingItems: allPlans.filter((item) => item.status === "pending"),
    blockedItems: allPlans.filter((item) => item.status === "blocked"),
    completedItems: allPlans.filter((item) => item.status === "completed"),
    releasedItems: allPlans.filter((item) => item.status === "released"),
  };
}

export function getOrderWorkflowPlan(db: Database, order: Order): OrderWorkflowPlan {
  const itemPlans = getOrderWorkflowItemPlans(db, order);
  const requiredStages = uniqueOrdered(itemPlans.flatMap((item) => item.stages.map((stage) => stage.id)));
  let currentAssigned = false;
  const stages: OrderWorkflowStageState[] = requiredStages.map((stageId) => {
    const itemStages = itemPlans.flatMap((item) =>
      item.stages.filter((stage) => stage.id === stageId),
    );
    const complete = itemStages.length > 0 && itemStages.every((stage) => stage.status === "complete");
    const blocked = itemStages.some((stage) => stage.status === "blocked");
    const status: OrderWorkflowStageState["status"] = complete
      ? "complete"
      : !currentAssigned
        ? ((currentAssigned = true), blocked ? "blocked" : "current")
        : "pending";
    return {
      id: stageId,
      label: stageMeta[stageId].label,
      description: stageMeta[stageId].description,
      module: stageMeta[stageId].module,
      status,
    };
  });

  const current = stages.find((stage) => stage.status === "current") ?? null;
  const blockedCurrent = stages.find((stage) => stage.status === "blocked") ?? null;
  const actionableItem =
    itemPlans.find((item) => item.status === "blocked") ??
    itemPlans.find((item) => item.nextStageId && item.nextModule !== "pathology") ??
    itemPlans.find((item) => item.nextStageId) ??
    null;
  const routeTags = getRouteTags(requiredStages);
  return {
    summary: routeTags.join(" -> "),
    routeTags,
    requiresTechnician: itemPlans.some((item) => item.stages.some((stage) => stage.module !== "pathology")),
    nextStageId: actionableItem?.nextStageId ?? blockedCurrent?.id ?? current?.id ?? null,
    nextStageLabel: actionableItem?.nextStageLabel ?? blockedCurrent?.label ?? current?.label ?? null,
    nextModule: actionableItem?.nextModule ?? blockedCurrent?.module ?? current?.module ?? null,
    reviewReady:
      itemPlans.length > 0 &&
      itemPlans.every((item) => item.terminal || item.reviewReady || ["completed", "released"].includes(item.status)),
    itemSummary: summarizeItemPlans(itemPlans),
    itemPlans,
    stages,
  };
}
