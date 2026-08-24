from decimal import Decimal
import unittest

from apps.core.domain import (
    ArchiveService,
    FinanceService,
    LimsRepository,
    OcrService,
    OrderService,
    Patient,
    WorkflowService,
)


class LimsE2ETests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = LimsRepository()
        self.orders = OrderService(self.repo)
        self.finance = FinanceService(self.repo)
        self.workflow = WorkflowService(self.repo)

    def create_paid_multitest_order(self):
        order = self.orders.create_order(
            actor_id="reception",
            source="walk_in",
            patient=Patient("Ada", "Nsame", "1988-02-03"),
            test_codes=["CBC", "HISTO-BX", "IHC-PANEL"],
        )
        self.finance.capture_payment(
            actor_id="finance",
            order_number=order.order_number,
            provider="maviance",
            amount=Decimal("76000"),
            gateway_reference="MAV-123",
        )
        return order

    def test_one_order_keeps_independent_test_workflows(self):
        order = self.create_paid_multitest_order()
        self.assertEqual(len(order.items), 3)
        self.assertNotEqual(order.items[0].workflow_steps, order.items[1].workflow_steps)

        cbc = order.items[0]
        for step in cbc.workflow_steps:
            self.workflow.complete_step(
                actor_id="tech-1",
                order_number=order.order_number,
                item_id=cbc.id,
                step=step,
            )

        self.assertEqual(cbc.status, "released")
        self.assertEqual(order.status, "partially_completed")
        self.assertEqual(order.items[1].status, "pending")
        self.assertEqual(order.items[2].status, "pending")

    def test_workflow_cannot_start_before_payment_clearance(self):
        order = self.orders.create_order(
            actor_id="reception",
            source="patient_portal",
            patient=Patient("Jean", "Mbarga", "1990-01-01"),
            test_codes=["CBC"],
        )
        with self.assertRaises(ValueError):
            self.workflow.complete_step(
                actor_id="tech-1",
                order_number=order.order_number,
                item_id=order.items[0].id,
                step="accessioning",
            )

    def test_ocr_verified_note_creates_order_and_keeps_raw_text(self):
        ocr = OcrService(self.repo)
        raw_text = "First Name: Marie\nLast Name: Etoundi\nDOB: 1979-05-10\nPlease run CBC and histology biopsy."
        job = ocr.create_job(actor_id="reception", file_bytes=b"typed note", extracted_text=raw_text)
        order = ocr.verify_and_create_order(actor_id="reception", job_id=job.id)

        self.assertEqual(job.raw_text, raw_text)
        self.assertEqual(job.status, "converted_to_order")
        self.assertEqual(job.created_order_number, order.order_number)
        self.assertIn("histology biopsy", order.clinical_notes)
        self.assertEqual([item.test.code for item in order.items], ["CBC", "HISTO-BX"])

    def test_invoice_before_payment_and_receipt_after_payment_are_printable(self):
        order = self.orders.create_order(
            actor_id="reception",
            source="walk_in",
            patient=Patient("Paul", "Fotso", "1980-08-08"),
            test_codes=["CBC"],
        )
        invoice_before = self.finance.printable_invoice(actor_id="reception", order_number=order.order_number)
        self.assertEqual(invoice_before["status"], "unpaid")

        receipt = self.finance.capture_payment(
            actor_id="finance",
            order_number=order.order_number,
            provider="paystack",
            amount=Decimal("6000"),
            gateway_reference="PSTK-1",
        )
        invoice_after = self.finance.printable_invoice(actor_id="finance", order_number=order.order_number)
        receipt_print = self.finance.printable_receipt(actor_id="finance", receipt_id=receipt.id)
        self.assertEqual(receipt.status, "completed")
        self.assertEqual(invoice_after["status"], "paid")
        self.assertEqual(receipt_print["invoiceStatus"], "paid")
        self.assertEqual(receipt_print["orderNumber"], order.order_number)

    def test_department_custody_is_department_level_but_user_actions_are_recorded(self):
        order = self.create_paid_multitest_order()
        handoff = self.workflow.transfer_department(
            actor_id="reception",
            order_number=order.order_number,
            to_department="histology",
        )
        self.workflow.record_user_interaction(
            actor_id="tech-a",
            order_number=order.order_number,
            action="scan",
        )
        self.workflow.record_user_interaction(
            actor_id="tech-b",
            order_number=order.order_number,
            action="grossing_note",
            notes="Specimen acceptable",
        )

        self.assertEqual(handoff.to_department, "histology")
        self.assertEqual(order.current_department, "histology")
        self.assertEqual([event.user_id for event in self.repo.user_events], ["tech-a", "tech-b"])

    def test_completed_order_archives_for_minimum_ten_years(self):
        order = self.create_paid_multitest_order()
        for item in order.items:
            for step in item.workflow_steps:
                self.workflow.complete_step(
                    actor_id="tech-1",
                    order_number=order.order_number,
                    item_id=item.id,
                    step=step,
                )
        archive = ArchiveService(self.repo).archive_order(actor_id="admin", order_number=order.order_number)
        self.assertGreaterEqual(archive.retention_until.year - archive.created_at.year, 9)

    def test_audit_chain_records_actions_immutably(self):
        self.create_paid_multitest_order()
        self.assertTrue(self.repo.audit.verify())
        self.assertGreaterEqual(len(self.repo.audit.events), 2)


if __name__ == "__main__":
    unittest.main()
