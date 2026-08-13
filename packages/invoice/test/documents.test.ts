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

/** The wrong-state failure, as the service now reports it: a 422 with a semantic code. */
function notDownloadable(detail = "Invoice is not in a downloadable state") {
  return errorResponse(422, "conflict", detail, { code: "not_downloadable" });
}

describe("the not-downloadable failure is named", () => {
  it("throws InvoiceNotDownloadableError for a cancelled invoice", async () => {
    const error = (await invoiceClient(fetchStub([notDownloadable()]))
      .getInvoicePdf(id)
      .catch((thrown: unknown) => thrown)) as InvoiceNotDownloadableError;

    expect(error).toBeInstanceOf(InvoiceNotDownloadableError);
    expect(error).toBeInstanceOf(InvoiceApiError);
    expect(error.name).toBe("InvoiceNotDownloadableError");
    expect(error.type).toBe("conflict");
    expect(error.code).toBe("not_downloadable");
  });

  it("is retryable, because a state can change", async () => {
    // A `pending` invoice becomes `created`. This used to be a flat 400, which said the opposite.
    const error = (await invoiceClient(fetchStub([notDownloadable()]))
      .getInvoicePdf(id)
      .catch((thrown: unknown) => thrown)) as InvoiceNotDownloadableError;
    expect(error.retryable).toBe(true);
  });

  it("does the same on the download-link endpoint, which shares the state requirement", async () => {
    const error = (await invoiceClient(fetchStub([notDownloadable()]))
      .createDownloadLink(id)
      .catch((thrown: unknown) => thrown)) as InvoiceNotDownloadableError;

    expect(error).toBeInstanceOf(InvoiceNotDownloadableError);
  });

  it("survives a reworded message, because it reads the code and not the prose", async () => {
    // The old parser lifted the status out of the sentence with a regex. The service names the
    // sub-case machine-readably now, so the wording can change freely.
    const error = (await invoiceClient(fetchStub([notDownloadable("Not downloadable right now")]))
      .getInvoicePdf(id)
      .catch((thrown: unknown) => thrown)) as InvoiceNotDownloadableError;

    expect(error).toBeInstanceOf(InvoiceNotDownloadableError);
  });

  it("leaves every other failure as a plain InvoiceApiError", async () => {
    for (const response of [errorResponse(404, "not-found"), errorResponse(502, "internal")]) {
      const error = (await invoiceClient(fetchStub([response]))
        .getInvoicePdf(id)
        .catch((thrown: unknown) => thrown)) as InvoiceApiError;

      expect(error).toBeInstanceOf(InvoiceApiError);
      expect(error).not.toBeInstanceOf(InvoiceNotDownloadableError);
    }
  });

  it("does not name a different wrong-state failure as not-downloadable", async () => {
    // `not_cancellable` is the same `(conflict, 422)` pair. Only `code` tells them apart, which
    // is exactly why the detection reads it rather than the status.
    const stub = fetchStub([
      errorResponse(422, "conflict", "Only created invoices can be cancelled", {
        code: "not_cancellable",
      }),
    ]);

    const error = (await invoiceClient(stub)
      .cancelInvoice(id)
      .catch((thrown: unknown) => thrown)) as InvoiceApiError;

    expect(error).toBeInstanceOf(InvoiceApiError);
    expect(error).not.toBeInstanceOf(InvoiceNotDownloadableError);
    expect(error.code).toBe("not_cancellable");
  });
});
