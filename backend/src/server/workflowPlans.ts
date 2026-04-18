import type {
  CytologyCase,
  Database,
  Order,
  OrderWorkflowModule,
  OrderWorkflowPlan,
  OrderWorkflowRouteGuide,
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

const workflowByTestId: Record<string, OrderWorkflowStageId[]> = {
  "test-pap": ["cytology_case", "cytology_screening", "cytology_qc", "pathologist_review", "report_signout", "result_release"],
  "test-body-fluids": [
    "cytology_case",
    "cytology_screening",
    "cytology_qc",
    "pathologist_review",
    "report_signout",
    "result_release",
  ],
  "test-biopsy": [
    "accessioning",
    "grossing",
    "processing",
    "embedding",
    "sectioning",
    "staining",
    "pathologist_review",
    "report_signout",
    "result_release",
  ],
  "test-resection": [
    "accessioning",
    "grossing",
    "processing",
    "embedding",
    "sectioning",
    "staining",
    "pathologist_review",
    "report_signout",
    "result_release",
  ],
  "test-tumor-ihc": [
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
  ],
  "test-pdl1": [
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
  ],
  "test-expert-local": ["pathologist_review", "report_signout", "result_release"],
  "test-expert-intl": ["pathologist_review", "report_signout", "result_release"],
  "test-strategy-insight": ["pathologist_review", "report_signout", "result_release"],
  "test-tumor-marker": ["analyzer_run", "pathologist_review", "report_signout", "result_release"],
  "test-peripheral-blood": [
    "cytology_case",
    "cytology_screening",
    "cytology_qc",
    "pathologist_review",
    "report_signout",
    "result_release",
  ],
  "test-bone-marrow-cytology": [
    "cytology_case",
    "cytology_screening",
    "cytology_qc",
    "pathologist_review",
    "report_signout",
    "result_release",
  ],
  "test-bone-marrow-histology": [
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
  ],
  "test-bone-marrow-complete": [
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
  "test-bcr-abl": ["molecular_sendout", "analyzer_run", "pathologist_review", "report_signout", "result_release"],
  "test-package-diagnostic": [
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
  ],
  "test-package-precision": [
    "accessioning",
    "grossing",
    "processing",
    "embedding",
    "sectioning",
    "staining",
    "ihc",
    "analyzer_run",
    "pathologist_review",
    "report_signout",
    "result_release",
  ],
  "test-package-ngs": ["molecular_sendout", "pathologist_review", "report_signout", "result_release"],
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

export function getRequiredWorkflowStages(order: Order) {
  const collected = uniqueOrdered(
    order.testTypeIds.flatMap((testTypeId) => workflowByTestId[testTypeId] ?? ["pathologist_review", "report_signout", "result_release"]),
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
    (order.testTypeIds.includes("test-pap")
      ? "Cervical smear"
      : order.testTypeIds.includes("test-body-fluids")
        ? "Body fluid specimen"
        : order.testTypeIds.includes("test-peripheral-blood")
          ? "Peripheral blood smear"
          : order.testTypeIds.includes("test-bone-marrow-cytology") ||
              order.testTypeIds.includes("test-bone-marrow-complete")
            ? "Bone marrow aspirate"
            : "Cytology specimen");

  return {
    specimenType,
    routeType: order.testTypeIds.includes("test-pap") ? ("gyn" as const) : ("non_gyn" as const),
    preparationType: order.testTypeIds.includes("test-pap")
      ? ("liquid_based" as const)
      : order.testTypeIds.includes("test-body-fluids")
        ? ("cell_block" as const)
        : ("smear" as const),
    remarks: `Auto-routed from ${tests.map((entry) => entry.code).join(", ")} workflow.`,
  };
}

export function inferAnalyzerRunType(order: Order) {
  if (order.testTypeIds.includes("test-bcr-abl")) {
    return "bcr_abl_analysis";
  }
  if (order.testTypeIds.includes("test-tumor-marker")) {
    return "tumor_marker_panel";
  }
  if (order.testTypeIds.includes("test-package-precision")) {
    return "precision_oncology_profile";
  }
  return "analyzer_run";
}

export function inferMolecularRunType(order: Order) {
  if (order.testTypeIds.includes("test-package-ngs")) {
    return "ngs_sendout";
  }
  return "molecular_sendout";
}

function hasAnalyzerRun(db: Database, order: Order) {
  const expected = inferAnalyzerRunType(order);
  return db.instrumentRuns.some(
    (entry) => entry.orderId === order._id && entry.runType === expected && entry.qcStatus !== "fail",
  );
}

function hasMolecularSendout(db: Database, order: Order) {
  const expected = inferMolecularRunType(order);
  return db.instrumentRuns.some(
    (entry) => entry.orderId === order._id && entry.runType === expected && entry.qcStatus !== "fail",
  );
}

function isStageComplete(db: Database, order: Order, stageId: OrderWorkflowStageId) {
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
      return hasAnalyzerRun(db, order);
    case "molecular_sendout":
      return hasMolecularSendout(db, order);
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
  return order.testTypeIds
    .map((testTypeId) => {
      const testType = db.testTypes.find((entry) => entry._id === testTypeId);
      if (!testType) {
        return null;
      }
      const stages = workflowByTestId[testTypeId] ?? ["pathologist_review", "report_signout", "result_release"];
      return {
        key: `${order._id}:${testTypeId}`,
        testTypeId,
        testCode: testType.code,
        testName: testType.name,
        category: testType.category,
        stages,
        routeTags: getRouteTags(stages),
        requiresAccession: stages.includes("accessioning"),
        primaryModule: stageMeta[stages[0]].module,
      } satisfies OrderWorkflowRouteGuide;
    })
    .filter((entry): entry is OrderWorkflowRouteGuide => Boolean(entry));
}

export function getOrderWorkflowPlan(db: Database, order: Order): OrderWorkflowPlan {
  const requiredStages = getRequiredWorkflowStages(order);
  let currentAssigned = false;
  const stages: OrderWorkflowStageState[] = requiredStages.map((stageId) => {
    const complete = isStageComplete(db, order, stageId);
    const status: OrderWorkflowStageState["status"] = complete
      ? "complete"
      : !currentAssigned
        ? ((currentAssigned = true), "current")
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
  const routeTags = getRouteTags(requiredStages);
  return {
    summary: routeTags.join(" -> "),
    routeTags,
    requiresTechnician: orderRequiresTechnicianWorkflow(order),
    nextStageId: current?.id ?? null,
    nextStageLabel: current?.label ?? null,
    nextModule: current?.module ?? null,
    reviewReady: current?.id === "pathologist_review",
    stages,
  };
}
