import type { Firestore } from "firebase-admin/firestore";

export interface OrganizationStoreConfiguration {
  storeId: string;
  name: string;
  companyId: string;
  mappingStatus: "PENDING_CONFIRMATION";
}

export interface OrganizationStructureConfiguration {
  organizationId: string;
  organizationName: string;
  directorRole: "DIRECTOR";
  schemaVersion: number;
  stores: OrganizationStoreConfiguration[];
  companyInventory?: {
    ownerMappingConfirmation?: {
      status: string;
      source: string;
    };
  };
  migrationMapping?: {
    status: string;
    source: string;
    appliedToFirestore: boolean;
    storeAssignments: Array<{
      storeId: string;
      companyId: string;
      existingCompanyId: string;
      companyIdAction: string;
    }>;
  };
}

export interface ExistingCompanySummary {
  companyId: string;
  organizationId: string | null;
  storeId: string | null;
}

export function inspectExistingCompanies(db: Firestore): Promise<ExistingCompanySummary[]>;
export function validateConfiguration(configuration: OrganizationStructureConfiguration): void;
export function provisionOrganizationStructure(
  db: Firestore,
  configuration: OrganizationStructureConfiguration,
  options?: { applyConfirmedCompanyMappings?: boolean; provisionNewStores?: boolean },
): Promise<{
  organizationId: string;
  createdOrganization: boolean;
  createdStores: string[];
  confirmedCompanyMappings: Array<{
    storeId: string;
    companyId: string;
    applied: true;
  }>;
  existingCompanyIds: string[];
  pendingStoreMappings: Array<{
    storeId: string;
    companyId: string;
    existingCompanyId: null;
  }>;
}>;
