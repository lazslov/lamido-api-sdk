import { describe, expect, it } from "vitest";
import { InvoiceApiError, InvoiceNotDownloadableError } from "../src/errors.js";
import { errorResponse, fetchStub, invoiceClient, pdfResponse } from "./stubs/fetch.js";

/**
 * The PDF paths: bytes plus a filename, and the documented state failure surfacing as a named error
 * rather than an opaque 4xx.
 */

const id = "6f1c2c8e-4b6d-4f2a-9c33-0b1f2a4d55aa";

describe("getInvoicePdf returns bytes and a filename", () => {
  it("reads a quoted filename out of Content-Disposition", async () => {
    const stub = fetchStub([pdfResponse('inline; filename="2026-0042.pdf"')]);
    const pdf = await invoiceClient(stub).getInvoicePdf(id);

    expect(pdf.filename).toBe("2026-0042.pdf");
    expect(pdf.bytes.byteLength).toBe(4);
  });

  it("reads an unquoted filename", async () => {
    const stub = fetchStub([pdfResponse("inline; filename=99123.pdf")]);
    expect((await invoiceClient(stub).getInvoicePdf(id)).filename).toBe("99123.pdf");
  });

  it("prefers the RFC 5987 form, and decodes it", async () => {
    const stub = fetchStub([
      pdfResponse("inline; filename=\"fallback.pdf\"; filename*=UTF-8''sz%C3%A1mla.pdf"),
    ]);
    expect((await invoiceClient(stub).getInvoicePdf(id)).filename).toBe("számla.pdf");
  });

  it("falls back to the invoice id when the service sent no disposition", async () => {
    const stub = fetchStub([pdfResponse()]);
    expect((await invoiceClient(stub).getInvoicePdf(id)).filename).toBe(`invoice-${id}.pdf`);
  });

  it("reduces a provider-supplied path to a bare filename", async () => {
    // The value originates at the provider and ends up in a header or a filename on disk; neither the
    // service nor the provider promises it is clean.
    const stub = fetchStub([pdfResponse('attachment; filename="../../etc/passwd"')]);
    expect((await invoiceClient(stub).getInvoicePdf(id)).filename).toBe("passwd");
  });

  it("falls back when the disposition names nothing usable", async () => {
    const stub = fetchStub([pdfResponse('attachment; filename=".."')]);
    expect((await invoiceClient(stub).getInvoicePdf(id)).filename).toBe(`invoice-${id}.pdf`);
  });
});

describe("the not-downloadable failure is named", () => {
  it("throws InvoiceNotDownloadableError for a cancelled invoice", async () => {
    const stub = fetchStub([
      errorResponse(
        400,
        "bad_request",
        "Invoice is not in a downloadable state (status: cancelled)",
      ),
    ]);

    const error = (await invoiceClient(stub)
      .getInvoicePdf(id)
      .catch((thrown: unknown) => thrown)) as InvoiceNotDownloadableError;

    expect(error).toBeInstanceOf(InvoiceNotDownloadableError);
    expect(error).toBeInstanceOf(InvoiceApiError);
    expect(error.name).toBe("InvoiceNotDownloadableError");
    expect(error.code).toBe("bad_request");
    expect(error.retryable).toBe(false);
    expect(error.invoiceStatus).toBe("cancelled");
  });

  it("does the same on the download-link endpoint, which shares the state requirement", async () => {
    const stub = fetchStub([
      errorResponse(400, "bad_request", "Invoice is not in a downloadable state (status: failed)"),
    ]);

    const error = (await invoiceClient(stub)
      .createDownloadLink(id)
      .catch((thrown: unknown) => thrown)) as InvoiceNotDownloadableError;

    expect(error).toBeInstanceOf(InvoiceNotDownloadableError);
    expect(error.invoiceStatus).toBe("failed");
  });

  it("reports a null status rather than a guess when the message is reworded", async () => {
    // Reading the status out of prose is a hint, and it fails closed.
    const stub = fetchStub([errorResponse(400, "bad_request", "Not downloadable right now")]);

    const error = (await invoiceClient(stub)
      .getInvoicePdf(id)
      .catch((thrown: unknown) => thrown)) as InvoiceNotDownloadableError;

    expect(error).toBeInstanceOf(InvoiceNotDownloadableError);
    expect(error.invoiceStatus).toBeNull();
  });

  it("leaves every other failure as a plain InvoiceApiError", async () => {
    for (const response of [
      errorResponse(404, "not_found"),
      errorResponse(502, "provider_error"),
    ]) {
      const error = (await invoiceClient(fetchStub([response]))
        .getInvoicePdf(id)
        .catch((thrown: unknown) => thrown)) as InvoiceApiError;

      expect(error).toBeInstanceOf(InvoiceApiError);
      expect(error).not.toBeInstanceOf(InvoiceNotDownloadableError);
    }
  });

  it("does not name a 400 on any other endpoint as not-downloadable", async () => {
    // The detection is path-based, and only /pdf and /download-link have that state requirement.
    const stub = fetchStub([
      errorResponse(400, "bad_request", "Only created invoices can be cancelled (status: failed)"),
    ]);

    const error = (await invoiceClient(stub)
      .cancelInvoice(id)
      .catch((thrown: unknown) => thrown)) as InvoiceApiError;

    expect(error).toBeInstanceOf(InvoiceApiError);
    expect(error).not.toBeInstanceOf(InvoiceNotDownloadableError);
  });
});
